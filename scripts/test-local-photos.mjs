import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { accounts, localClient, localSettings, localTestPassword, sql, venueId } from './local-tools.mjs'
import { createDecision, liftDecision, loadData, memberships } from '../src/backend.ts'
import { discardIncidentPhoto, photoRequest, submitIncident } from '../src/incident-photo-backend.ts'
import { photoBucket, photoMaxBytes, validateIncidentPhoto } from '../src/incident-photo-files.ts'

const fileFrom = (data, type) => new File([Buffer.from(data, 'base64')], 'fictional-image', { type })
const png = fileFrom('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPQXFxDU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJIuIEx43rN3AAAAAElFTkSuQmCC', 'image/png')
const jpeg = fileFrom('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAv/aAAwDAQACEQMRAD8Ax6KKK0P4XCiiigD/0MeiiitD+FwooooA/9k=', 'image/jpeg')
const webp = fileFrom('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA', 'image/webp')
const noProgress = () => {}
const report = id => ({
  label: `Fictional photo test ${id.slice(0, 8)}`,
  occurredAt: new Date(Date.now() - 86400000).toISOString(),
  incidentType: 'other', severity: 'low', appearance: 'Imaginary green shape',
  description: 'Synthetic integration test report.',
})

async function main() {
  const { url, anon, admin } = localSettings()
  const fixtureAdmin = localClient(url, admin)
  const makeClient = () => localClient(url, anon)
  const [owner, staff2, manager, outsider, inactive, anonymous] = Array.from({ length: 6 }, makeClient)
  const storage = client => client.storage.from(photoBucket)
  const otherVenue = randomUUID()
  const fixtureUsers = []
  let venueCreated = false
  const password = localTestPassword()
  async function login(client, email) {
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null)
  }
  async function prepare(attempt, actor = owner) {
    const response = await actor.rpc('prepare_incident_photo', photoRequest(venueId, attempt.reportId, attempt.photo.uploadId)).single()
    assert.equal(response.error, null)
    return response.data
  }
  function attemptFor(file) {
    return { reportId: randomUUID(), ...(file && { photo: { file, uploadId: randomUUID() } }) }
  }
  async function allowed(client, id, path) {
    const metadata = await client.from('incident_photos').select('bucket_id,object_path').eq('report_id', id)
    assert.equal(metadata.error, null)
    assert.deepEqual(metadata.data, [{ bucket_id: photoBucket, object_path: path }])
    const download = await storage(client).download(path, {}, { cache: 'no-store' })
    assert.equal(download.error, null)
    assert.deepEqual(Buffer.from(await download.data.arrayBuffer()), Buffer.from(await png.arrayBuffer()))
  }
  async function denied(client, id, path, isAnonymous = false) {
    const metadata = await client.from('incident_photos').select('object_path').eq('report_id', id)
    if (isAnonymous) assert.ok(metadata.error)
    else { assert.equal(metadata.error, null); assert.deepEqual(metadata.data, []) }
    assert.ok((await storage(client).download(path, {}, { cache: 'no-store' })).error)
  }

  try {
    await Promise.all([owner, staff2, manager].map((client, index) => login(client, accounts[index].email)))
    for (const client of [outsider, inactive]) {
      const email = `photo-fixture-${randomUUID()}@teambrief.test`
      const result = await fixtureAdmin.auth.admin.createUser({ email, password, email_confirm: true })
      assert.equal(result.error, null)
      fixtureUsers.push(result.data.user.id)
      await login(client, email)
    }
    sql(`
      begin;
      insert into public.venues (id, name) values ('${otherVenue}', 'Fictional photo test pub');
      insert into public.venue_memberships (venue_id, user_id, role, is_active)
        values ('${otherVenue}', '${fixtureUsers[0]}', 'manager', true),
               ('${venueId}', '${fixtureUsers[1]}', 'staff', false);
      commit;
    `)
    venueCreated = true

    for (const client of [outsider, inactive, anonymous]) {
      for (const rpc of ['find_active_bans', 'get_teambrief_totals']) {
        assert.ok((await client.rpc(rpc, { p_venue_id: venueId })).error)
      }
    }
    const attempt = attemptFor(png)
    const draft = report(attempt.reportId)
    const { object_path: path, uploaded } = await prepare(attempt)
    assert.equal(uploaded, false)
    assert.match(path, new RegExp(`^${venueId}/${attempt.reportId}/[a-f0-9-]{36}$`))
    const request = photoRequest(venueId, attempt.reportId, attempt.photo.uploadId)
    for (const client of [anonymous, inactive, outsider]) {
      assert.ok((await client.rpc('prepare_incident_photo', request)).error)
    }
    for (const client of [staff2, manager, outsider, inactive, anonymous]) {
      assert.ok((await storage(client).upload(path, png)).error)
    }
    assert.ok((await storage(owner).upload(`${venueId}/${attempt.reportId}/${randomUUID()}`, png)).error)
    assert.ok((await storage(owner).createSignedUploadUrl(path)).error)
    const gif = new File(['GIF89a'], 'fictional.gif', { type: 'image/gif' })
    await assert.rejects(() => validateIncidentPhoto(gif), /JPEG, PNG or WebP/)
    await assert.rejects(() => validateIncidentPhoto(new File(['ftypheic'], 'fictional.heic', { type: 'image/heic' })), /HEIC/)
    await assert.rejects(() => validateIncidentPhoto(new File(['<svg/>'], 'fictional.png', { type: 'image/png' })), /JPEG, PNG or WebP/)
    assert.match((await storage(owner).upload(path, gif)).error?.message ?? '', /mime|type/i)
    const oversized = new File([new Uint8Array(photoMaxBytes + 1)], 'fictional-oversized.png', { type: 'image/png' })
    await assert.rejects(() => validateIncidentPhoto(oversized), /5 MB/)
    assert.match((await storage(owner).upload(path, oversized)).error?.message ?? '', /size|large|limit|maximum/i)

    await assert.rejects(() => submitIncident(owner, venueId, { ...draft, label: '' }, attempt, noProgress))
    assert.equal((await prepare(attempt)).uploaded, true, 'failed finalization keeps the retryable uploaded object')
    assert.deepEqual((await owner.from('incident_reports').select('id').eq('id', attempt.reportId)).data, [])
    await denied(owner, attempt.reportId, path)
    await denied(manager, attempt.reportId, path)

    const created = await Promise.all([1, 2].map(() => submitIncident(owner, venueId, draft, attempt, noProgress)))
    assert.deepEqual(created, [attempt.reportId, attempt.reportId])
    assert.deepEqual((await owner.from('incident_reports').select('id').eq('id', attempt.reportId)).data, [{ id: attempt.reportId }])
    await assert.rejects(() => submitIncident(owner, venueId, { ...draft, label: 'Changed after save' }, attempt, noProgress), /already saved/)
    await allowed(owner, attempt.reportId, path)
    await allowed(manager, attempt.reportId, path)
    for (const client of [owner, manager]) {
      const { data: { user } } = await client.auth.getUser()
      const [member] = await memberships(client, user.id)
      const report = (await loadData(client, member)).incidents.find(r => r.id === attempt.reportId)
      assert.deepEqual(report?.photo, { reportId: attempt.reportId, path })
    }

    await denied(staff2, attempt.reportId, path)
    await denied(outsider, attempt.reportId, path)
    await denied(inactive, attempt.reportId, path)
    await denied(anonymous, attempt.reportId, path, true)
    assert.ok((await fetch(`${url}/storage/v1/object/public/${photoBucket}/${path}`, { redirect: 'error' })).status >= 400)
    assert.ok((await storage(owner).createSignedUrl(path, 30)).error)
    assert.ok((await owner.from('incident_photos').delete().eq('report_id', attempt.reportId)).error)

    const ban = await createDecision(manager, venueId, attempt.reportId, {
      kind: 'ban', explanation: 'Synthetic test', severity: 'low', instruction: 'Synthetic no service',
      reviewAt: new Date(Date.now() + 86400000).toISOString(),
    })
    await allowed(staff2, attempt.reportId, path)
    const directory = await staff2.rpc('find_active_bans', { p_venue_id: venueId, p_decision_id: ban })
    assert.equal(directory.error, null)
    assert.equal(directory.data[0]?.photo_path, path)
    assert.deepEqual(Object.keys(directory.data[0]).sort(), [
      'appearance', 'decided_at', 'decision_id', 'has_more', 'instruction', 'label', 'photo_path', 'report_id', 'review_at', 'severity',
    ])

    await denied(outsider, attempt.reportId, path)
    await denied(inactive, attempt.reportId, path)
    assert.ok((await storage(staff2).createSignedUrl(path, 30)).error)
    for (const client of [staff2, manager, owner]) {
      assert.ok((await storage(client).upload(path, webp, { upsert: true })).error)
      assert.ok((await storage(client).update(path, webp)).error)
      const deletion = await storage(client).remove([path])
      assert.ok(deletion.error || deletion.data.length === 0)
    }
    await discardIncidentPhoto(owner, venueId, attempt.reportId, attempt.photo.uploadId)
    await allowed(owner, attempt.reportId, path)
    await liftDecision(manager, venueId, ban, 'Synthetic test completed', 'Resume normal service.')
    await denied(staff2, attempt.reportId, path)
    await allowed(owner, attempt.reportId, path)
    await allowed(manager, attempt.reportId, path)

    const textOnly = attemptFor()
    assert.equal(await submitIncident(owner, venueId, report(textOnly.reportId), textOnly, noProgress), textOnly.reportId)
    assert.deepEqual((await owner.from('incident_photos').select('report_id').eq('report_id', textOnly.reportId)).data, [])

    const retry = attemptFor(jpeg)
    const retryDraft = report(retry.reportId)
    const stageCalls = []
    const interrupted = {
      rpc: owner.rpc.bind(owner),
      storage: { from: () => ({ upload: async (...args) => {
        const result = await storage(owner).upload(...args)
        assert.equal(result.error, null)
        return { error: new Error('Synthetic lost upload response') }
      } }) },
    }
    await assert.rejects(() => submitIncident(interrupted, venueId, retryDraft, retry, stage => stageCalls.push(stage)), /upload could not be confirmed/)
    assert.deepEqual(stageCalls, ['Preparing photo upload…', 'Uploading photo…'])
    assert.deepEqual((await owner.from('incident_reports').select('id').eq('id', retry.reportId)).data, [])
    assert.equal((await prepare(retry)).uploaded, true)
    const lostSaveConfirmation = {
      rpc: (name, args) => {
        const response = owner.rpc(name, args)
        if (name !== 'submit_incident_report') return response
        return response.then(result => {
          assert.equal(result.error, null)
          return { error: { message: 'Synthetic lost save response' }, status: 0 }
        })
      },
      storage: owner.storage,
    }
    await assert.rejects(() => submitIncident(lostSaveConfirmation, venueId, retryDraft, retry, noProgress), /Keep this form open and retry/)
    assert.equal(await submitIncident(owner, venueId, retryDraft, retry, noProgress), retry.reportId)
    assert.deepEqual((await owner.from('incident_reports').select('id').eq('id', retry.reportId)).data, [{ id: retry.reportId }])
    const jpegPath = (await prepare(retry)).object_path
    const jpegDownload = await storage(owner).download(jpegPath)
    assert.equal(jpegDownload.error, null)
    assert.equal(await validateIncidentPhoto(jpegDownload.data), 'image/jpeg')


    const discarded = attemptFor(webp)
    const discardedPath = (await prepare(discarded)).object_path
    assert.equal((await storage(owner).upload(discardedPath, webp)).error, null)
    assert.ok((await storage(owner).remove([discardedPath])).data?.length === 0, 'cannot delete staged bytes without abandoning')
    await discardIncidentPhoto(owner, venueId, discarded.reportId, discarded.photo.uploadId)
    assert.equal(sql(`select count(*) from storage.objects where bucket_id = 'incident-photos' and name = '${discardedPath}';`).trim(), '0')
    assert.ok((await storage(owner).upload(discardedPath, webp)).error, 'abandoned path cannot be reused')
    const expired = attemptFor(webp)
    const expiredPath = (await prepare(expired)).object_path
    assert.equal((await storage(owner).upload(expiredPath, webp)).error, null)
    sql(`update teambrief_private.incident_photo_uploads set expires_at = now() - interval '1 minute' where object_path = '${expiredPath}';`)
    execFileSync('npm', ['run', 'cleanup:local:photos', '--', discarded.reportId, expired.reportId], { stdio: ['ignore', 'pipe', 'pipe'] })
    assert.equal(sql(`select count(*) from storage.objects where bucket_id = 'incident-photos' and name = '${expiredPath}';`).trim(), '0')
    await allowed(owner, attempt.reportId, path)
  } finally {
    await Promise.all([owner, staff2, manager, outsider, inactive].map(client => client.auth.signOut({ scope: 'local' })))
    if (venueCreated) {
      sql(`delete from public.venue_memberships where venue_id = '${otherVenue}';
           delete from public.venue_memberships where venue_id = '${venueId}' and user_id = '${fixtureUsers[1]}';
           delete from public.venues where id = '${otherVenue}';`)
    }
    if (fixtureUsers.length) {
      sql(`delete from public.profiles where id in (${fixtureUsers.map(id => `'${id}'`).join(',')});`)
    }
    for (const user of fixtureUsers) {
      assert.equal((await fixtureAdmin.auth.admin.deleteUser(user)).error, null)
    }
  }
  console.log('PASS: local HTTP/JWT photo ownership, ban visibility and revocation, private Storage, type/size enforcement, idempotent retries, and staged cleanup.')
}

main().catch(error => {
  console.error('FAIL: local photo HTTP/JWT checks.', error.stack?.split('\n').filter(line => line.includes('test-local-photos.mjs:')).join('\n'))
  process.exitCode = 1
})
