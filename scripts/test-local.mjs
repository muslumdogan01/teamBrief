import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { accounts, localSettings, localTestPassword, venueId } from './local-tools.mjs'
import { createIncident, createDecision, liftDecision, loadData, memberships } from '../src/backend.ts'
async function main() {
  const password = localTestPassword()
  const { url, anon } = localSettings()
  const clients = accounts.map(() => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }))
  try {
    for (const [i, client] of clients.entries()) {
      const r = await client.auth.signInWithPassword({ email: accounts[i].email, password })
      assert.equal(r.error, null, 'real password sign-in')
    }
    const [staff1, staff2, manager] = clients
    const user1 = (await staff1.auth.getUser()).data.user.id
    const user2 = (await staff2.auth.getUser()).data.user.id
    const boss = (await manager.auth.getUser()).data.user.id
    const [member1] = await memberships(staff1, user1)
    const [member2] = await memberships(staff2, user2)
    const [memberBoss] = await memberships(manager, boss)
    assert.equal(member1.role, 'employee'); assert.equal(memberBoss.role, 'manager')
    assert.equal(member1.venueId, venueId)
    assert.ok((await staff1.from('venue_memberships').update({ role: 'manager' }).eq('user_id', user1)).error, 'staff cannot promote self')
    const id = await createIncident(staff1, venueId, { label: 'Fictional HTTP test guest', occurredAt: new Date(Date.now() - 86400000).toISOString(), incidentType: 'other', severity: 'low', appearance: 'Imaginary green hat', description: 'Fictional private HTTP test incident.' })
    const draft = { kind: 'ban', explanation: 'Fictional test reason', severity: 'low', instruction: 'Do not serve this fictional guest', reviewAt: new Date(Date.now() + 86400000).toISOString() }
    await assert.rejects(() => createDecision(staff1, venueId, id, draft))
    assert.deepEqual((await staff2.from('incident_reports').select('*').eq('id', id)).data, [], 'staff2 cannot read staff1 full text')
    const decisionId = await createDecision(manager, venueId, id, draft)
    const active = await loadData(staff2, member2)
    assert.ok(active.decisions.some(d => d.id === decisionId), 'staff2 sees active decision')
    assert.ok(!active.incidents.some(d => d.id === id), 'adapter does not fetch cross-author incidents')
    assert.ok(active.summaries.some(s => s.decisionId === decisionId && s.appearance === 'Imaginary green hat'))
    const projected = await staff2.rpc('get_active_decision_incidents', { p_venue_id: venueId })
    assert.equal(projected.error, null)
    const summary = projected.data.find(s => s.decision_id === decisionId)
    assert.deepEqual(Object.keys(summary).sort(), ['appearance','decision_id','incident_type','label','occurred_at','report_id','venue_id'])
    await assert.rejects(() => liftDecision(staff2, venueId, decisionId, 'Denied'))
    const foreignVenue = '30000000-0000-0000-0000-000000000099'
    assert.ok((await staff2.rpc('get_active_decision_incidents', { p_venue_id: foreignVenue })).error, 'unassigned pub RPC denied')
    assert.deepEqual((await manager.from('incident_reports').select('*').eq('venue_id', foreignVenue)).data, [])
    await liftDecision(manager, venueId, decisionId, 'Fictional HTTP test complete')
    const after = await loadData(staff2, member2)
    assert.ok(!after.decisions.some(d => d.id === decisionId), 'lifted decision disappears for other staff')
    assert.ok(!after.summaries.some(s => s.decisionId === decisionId), 'lifted summary disappears')
    assert.equal((await loadData(staff1, member1)).history.filter(h => h.decisionId === decisionId).length, 2)
    assert.equal((await loadData(manager, memberBoss)).history.filter(h => h.decisionId === decisionId).length, 2)
    const noBanReport = await createIncident(staff1, venueId, { label: 'Fictional no-ban guest', occurredAt: new Date(Date.now() - 86400000).toISOString(), incidentType: 'other', severity: 'low', appearance: 'Imaginary blue hat', description: 'Fictional no-ban HTTP test.' })
    const noBanId = await createDecision(manager, venueId, noBanReport, { ...draft, kind: 'no-ban', explanation: 'No ongoing ban required for fictional test.' })
    assert.ok((await loadData(staff1, member1)).decisions.some(d => d.id === noBanId && d.kind === 'no-ban'))
    assert.ok(!(await loadData(staff2, member2)).decisions.some(d => d.id === noBanId))
    assert.equal((await staff1.auth.signOut({ scope: 'local' })).error, null)
    assert.equal((await staff1.auth.getSession()).data.session, null)
    assert.ok((await staff1.rpc('get_active_decision_incidents', { p_venue_id: venueId })).error, 'signed-out RPC denied')
    assert.ok((await staff1.auth.signInWithPassword({ email: accounts[0].email, password: 'incorrect-local-password' })).error, 'wrong password rejected')
    console.log('PASS: real HTTP/JWT sign-in/out, wrong-password handling, membership mapping, self-promotion denial, staff/manager RPC permissions, cross-author privacy, active summary projection, ban lifting and history. Fictional test report/history retained; ban lifted.')
  } finally { await Promise.all(clients.map(c => c.auth.signOut({ scope: 'local' }))) }
}
main().catch(() => { console.error('FAIL: local HTTP/JWT checks failed (credentials suppressed).'); process.exitCode = 1 })
