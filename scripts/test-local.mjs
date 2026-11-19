import assert from 'node:assert/strict'
import { accounts, localClient, localSettings, localTestPassword, venueId } from './local-tools.mjs'
import { createIncident, createDecision, findActiveBans, liftDecision, loadData, markUpdateRead, memberships } from '../src/backend.ts'
import { decisionStatus } from '../src/decision-status.ts'
async function main() {
  const password = localTestPassword()
  const { url, anon } = localSettings()
  const clients = accounts.map(() => localClient(url, anon))
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
    const ownStatus = async reportId => {
      const incident = (await loadData(staff1, member1)).incidents.find(report => report.id === reportId)
      assert.ok(incident, 'the report is visible to its author')
      return decisionStatus(incident.decision)
    }
    assert.equal(await ownStatus(id), 'awaiting-review')
    await assert.rejects(() => createDecision(staff1, venueId, id, draft))
    assert.deepEqual((await staff2.from('incident_reports').select('*').eq('id', id)).data, [], 'staff2 cannot read staff1 full text')
    const decisionId = await createDecision(manager, venueId, id, draft)
    assert.equal(await ownStatus(id), 'active-ban')
    const active = await loadData(staff2, member2)
    assert.ok(active.decisions.some(d => d.id === decisionId), 'staff2 sees active decision')
    assert.ok(!active.incidents.some(d => d.id === id), 'adapter does not fetch cross-author incidents')
    const findBans = query => findActiveBans(staff2, venueId, query, 20, new AbortController().signal)
    const directory = await findBans('imaginary GREEN hat')
    assert.ok(directory.items.some(s => s.decision_id === decisionId && s.appearance === 'Imaginary green hat'))
    const projected = await staff2.rpc('get_active_decision_incidents', { p_venue_id: venueId })
    assert.equal(projected.error, null)
    const summary = projected.data.find(s => s.decision_id === decisionId)
    assert.deepEqual(Object.keys(summary).sort(), ['appearance','decision_id','incident_type','label','occurred_at','report_id','venue_id'])
    await assert.rejects(() => liftDecision(staff2, venueId, decisionId, 'Denied', 'Denied note'))
    const foreignVenue = '30000000-0000-0000-0000-000000000099'
    assert.ok((await staff2.rpc('get_active_decision_incidents', { p_venue_id: foreignVenue })).error, 'unassigned pub RPC denied')
    assert.deepEqual((await manager.from('incident_reports').select('*').eq('venue_id', foreignVenue)).data, [])
    const decisionUpdates = client => client.from('venue_updates').select('*').eq('decision_id', decisionId)
    await assert.rejects(() => liftDecision(manager, venueId, decisionId, 'Private fixture reason', '  '))
    assert.deepEqual((await decisionUpdates(staff2)).data, [])
    assert.ok((await loadData(staff2, member2)).decisions.some(d => d.id === decisionId && !d.liftedAt))
    const lift = () => liftDecision(manager, venueId, decisionId, 'Private fixture reason', 'Resume normal service for this fictional guest.')
    const lifts = await Promise.allSettled([lift(), lift()])
    assert.equal(lifts.filter(r => r.status === 'fulfilled').length, 1)
    const { data: events, error: updateError } = await decisionUpdates(staff2)
    assert.equal(updateError, null)
    assert.equal(events.length, 1)
    const updateId = events[0].id
    assert.deepEqual(Object.keys(events[0]).sort(), ['decision_id', 'event_type', 'id', 'occurred_at', 'person_label', 'service_note', 'venue_id'])
    assert.equal(await ownStatus(id), 'ban-lifted')
    const after = await loadData(staff2, member2)
    const update = after.updates.find(u => u.id === updateId)
    assert.deepEqual(update, {
      id: updateId, eventType: 'ban_lifted', personLabel: 'Fictional HTTP test guest',
      serviceNote: 'Resume normal service for this fictional guest.',
      occurredAt: events[0].occurred_at, readAt: null,
    })
    assert.equal((await loadData(manager, memberBoss)).updates.find(u => u.id === updateId).readAt, null)
    await assert.rejects(() => markUpdateRead(staff2, foreignVenue, updateId))
    assert.deepEqual((await staff2.rpc('get_recent_updates', { p_venue_id: foreignVenue })).data, [])
    assert.ok((await staff2.from('venue_updates').insert({ venue_id: venueId })).error)
    assert.ok((await staff2.from('venue_update_reads').insert({ update_id: updateId, user_id: user1 })).error)
    await markUpdateRead(staff2, venueId, updateId)
    const readAt = (await loadData(staff2, member2)).updates.find(u => u.id === updateId).readAt
    assert.ok(readAt)
    await markUpdateRead(staff2, venueId, updateId)
    assert.equal((await staff2.auth.signOut({ scope: 'local' })).error, null)
    assert.equal((await staff2.auth.signInWithPassword({ email: accounts[1].email, password })).error, null)
    assert.equal((await loadData(staff2, member2)).updates.find(u => u.id === updateId).readAt, readAt)
    assert.equal((await loadData(staff1, member1)).updates.find(u => u.id === updateId).readAt, null)
    assert.deepEqual((await staff1.from('venue_update_reads').select('*').eq('update_id', updateId)).data, [])
    assert.ok(!after.decisions.some(d => d.id === decisionId), 'lifted decision disappears for other staff')
    assert.ok(!(await findBans('imaginary GREEN hat')).items.some(s => s.decision_id === decisionId), 'lifted ban disappears from search')
    assert.equal((await loadData(staff1, member1)).history.filter(h => h.decisionId === decisionId).length, 2)
    assert.equal((await loadData(manager, memberBoss)).history.filter(h => h.decisionId === decisionId).length, 2)
    const noBanReport = await createIncident(staff1, venueId, { label: 'Fictional no-ban guest', occurredAt: new Date(Date.now() - 86400000).toISOString(), incidentType: 'other', severity: 'low', appearance: 'Imaginary blue hat', description: 'Fictional no-ban HTTP test.' })
    const noBanId = await createDecision(manager, venueId, noBanReport, { ...draft, kind: 'no-ban', explanation: 'No ongoing ban required for fictional test.' })
    assert.equal(await ownStatus(noBanReport), 'no-ban')
    assert.ok((await loadData(staff1, member1)).decisions.some(d => d.id === noBanId && d.kind === 'no-ban'))
    assert.ok(!(await loadData(staff2, member2)).decisions.some(d => d.id === noBanId))
    assert.equal((await staff1.auth.signOut({ scope: 'local' })).error, null)
    assert.equal((await staff1.auth.getSession()).data.session, null)
    assert.ok((await staff1.rpc('get_active_decision_incidents', { p_venue_id: venueId })).error, 'signed-out RPC denied')
    assert.ok((await staff1.rpc('get_recent_updates', { p_venue_id: venueId })).error)
    await assert.rejects(() => markUpdateRead(staff1, venueId, updateId))
    assert.ok((await staff1.auth.signInWithPassword({ email: accounts[0].email, password: 'incorrect-local-password' })).error, 'wrong password rejected')
    console.log('PASS: real HTTP/JWT sign-in/out, wrong-password handling, membership mapping, self-promotion denial, staff/manager RPC permissions, cross-author privacy, active summary projection, atomic ban lifting and history, Recent Updates access and independent durable read receipts, and all four report statuses. Fictional test report/history retained; ban lifted.')
  } finally { await Promise.all(clients.map(c => c.auth.signOut({ scope: 'local' }))) }
}
main().catch(error => { console.error('FAIL: local HTTP/JWT checks failed at', error.stack?.split('\n').find(line => line.includes('test-local.mjs:'))?.trim() ?? 'local setup'); process.exitCode = 1 })
