import test from 'node:test'
import assert from 'node:assert/strict'
import { clientConfig, localUrl } from '../src/local-config.ts'
import { requestScope, runMutation } from '../src/session-state.ts'
import { checked, createDecision } from '../src/backend.ts'

test('local-only configuration rejects remote URLs, missing settings and privileged keys', () => {
  assert.throws(() => clientConfig(), /not configured/)
  for (const url of ['https://example.supabase.co', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'http://localhost/remote']) assert.throws(() => localUrl(url))
  const jwt = role => `header.${btoa(JSON.stringify({role}))}.signature`
  assert.equal(clientConfig('http://127.0.0.1:54321', jwt('anon')).url, 'http://127.0.0.1:54321')
  assert.throws(() => clientConfig('http://localhost:54321', jwt('service_role')), /Privileged/)
  assert.throws(() => clientConfig('http://localhost:54321', 'sb_secret_fake'), /Privileged/)
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
