import test from 'node:test'
import assert from 'node:assert/strict'
import { clientConfig, localUrl } from '../src/supabase-config.ts'
import { requestScope, runMutation } from '../src/session-state.ts'
import { checked, createDecision, loadData } from '../src/backend.ts'

test('client configuration distinguishes local development from hosted demo builds', () => {
  const jwt = role => `header.${btoa(JSON.stringify({ role }))}.signature`
  const cloud = 'https://example.supabase.co'
  assert.throws(() => clientConfig(), /not configured/)
  assert.deepEqual(clientConfig(cloud, 'sb_publishable_example'), {
    url: cloud, key: 'sb_publishable_example', environment: 'Demo environment',
  })
  assert.equal(clientConfig('http://127.0.0.1:54321', jwt('anon'), true).environment, 'Local test environment')
  for (const url of ['http://127.0.0.1:54321', 'https://localhost.', 'https://127.0.0.2', 'https://[::1]']) {
    assert.throws(() => clientConfig(url, jwt('anon')), /requires a hosted/)
  }
  for (const url of ['http://example.supabase.co', 'https://user:pass@example.supabase.co', `${cloud}/rest/v1`]) {
    assert.throws(() => clientConfig(url, jwt('anon')))
  }
  for (const key of [jwt('service_role'), jwt('authenticated'), 'sb_secret_fake', 'sb_publishable_']) {
    assert.throws(() => clientConfig(cloud, key), /Privileged/)
  }
})

test('local tools accept only the local HTTP API origin', () => {
  assert.equal(localUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321')
  for (const url of ['https://example.supabase.co', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'http://localhost/remote']) {
    assert.throws(() => localUrl(url))
  }
})
test('account invalidation rejects delayed requests, including an account switch back', async () => {
  const scope = requestScope()
  const old = scope.ticket()
  scope.invalidate(); const current = scope.ticket()
  assert.equal(scope.current(old), false)
  assert.equal(scope.current(current), true)
  scope.invalidate()
  assert.equal(scope.current(old), false)
  assert.equal(scope.current(current), false)
})
test('failed mutations never refresh or return success; failed refresh warns against duplicate writes', async () => {
  let calls = 0
  await assert.rejects(() => runMutation(async () => { throw new Error('Denied') }, async () => { calls++ }), /Denied/)
  assert.equal(calls, 0)
  await assert.rejects(() => runMutation(async () => { calls++ }, async () => { throw new Error('offline') }), /Saved, but refreshing failed/)
  assert.equal(calls, 1)
  assert.throws(() => checked({ data: null, error: {message: 'Denied'} }), /Denied/)
})
test('no-ban adapter sends explicit NULL ban fields instead of demo values', async () => {
  let params
  await createDecision({rpc: async (name, input) => { assert.equal(name, 'create_decision'); params = input; return {data: 'uuid',error:null} }}, 'venue', 'report', {kind:'no-ban',explanation:'Reason',severity:'high',instruction:'ignored',reviewAt:'invalid'})
  assert.deepEqual(params, {p_venue_id:'venue',p_report_id:'report',p_kind:'no-ban',p_explanation:'Reason',p_severity:null,p_instruction:null,p_review_at:null})
})

test('manager history continues past the first batch when decision timestamps tie', async () => {
  const timestamp = '2026-11-18T10:00:00.000000+00:00'
  const decisions = Array.from({ length: 201 }, (_, index) => ({
    id: `60000000-0000-0000-0000-${String(201 - index).padStart(12, '0')}`,
    decided_at: timestamp,
    kind: 'no-ban',
  }))
  const requests = []
  const client = {
    from(table) {
      let cursor
      let limit
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit(value) { limit = value; return query },
        or(value) { cursor = value; return query },
        then(resolve) {
          const start = cursor ? 200 : 0
          if (table === 'decisions') requests.push({ cursor, limit })
          return Promise.resolve({ data: table === 'decisions' ? decisions.slice(start, start + limit) : [], error: null }).then(resolve)
        },
      }
      return query
    },
    rpc: async () => ({ data: [], error: null }),
  }
  const data = await loadData(client, { venueId: 'pub', role: 'manager' })
  assert.deepEqual(requests, [
    { cursor: undefined, limit: 200 },
    { cursor: `decided_at.lt.${timestamp},and(decided_at.eq.${timestamp},id.lt.${decisions[199].id})`, limit: 200 },
  ])
  assert.deepEqual(data.decisions.map(d => d.id), decisions.map(d => d.id))
})
