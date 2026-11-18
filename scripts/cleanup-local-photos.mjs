import { createClient } from '@supabase/supabase-js'
import { photoBucket } from '../src/incident-photo-files.ts'
import { localSettings, sql } from './local-tools.mjs'

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const expectedId = new RegExp(`^${uuid}$`)
const expectedPath = new RegExp(`^${uuid}/${uuid}/${uuid}$`)

async function cleanup() {
  const reportIds = process.argv.slice(2)
  if (!reportIds.every(id => expectedId.test(id))) throw new Error('Report IDs must be UUIDs')
  const reportFilter = reportIds.length ? `and report_id in (${reportIds.map(id => `'${id}'`).join(',')})` : ''
  const { url, admin } = localSettings()
  const storage = createClient(url, admin, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(photoBucket)
  // Close reservations before touching object bytes. This row lock serializes with
  // finalization and the Storage INSERT policy, so committed reports are excluded.
  const closed = sql(`
    update teambrief_private.incident_photo_uploads
      set abandoned_at = coalesce(abandoned_at, statement_timestamp())
      where not committed and (abandoned_at is not null or expires_at <= statement_timestamp())
        ${reportFilter}
      returning object_path;
  `).split('\n').filter(path => path.includes('/'))
  if (!closed.every(path => expectedPath.test(path))) throw new Error('Unexpected incident photo path')

  for (let start = 0; start < closed.length; start += 100) {
    const paths = closed.slice(start, start + 100)
    const { error } = await storage.remove(paths)
    if (error) throw error
    const remaining = sql(`
      delete from teambrief_private.incident_photo_uploads u
        where not u.committed and u.abandoned_at is not null
          and u.object_path in (${paths.map(path => `'${path}'`).join(',')})
          and not exists (
            select 1 from storage.objects o where o.bucket_id = 'incident-photos' and o.name = u.object_path
          );
      select count(*) from storage.objects
        where bucket_id = 'incident-photos' and name in (${paths.map(path => `'${path}'`).join(',')});
    `).trim().split('\n').at(-1)
    if (remaining !== '0') throw new Error('Some staged objects remain')
  }
  console.log(`Cleaned ${closed.length} abandoned or expired local photo reservation(s).`)
}
cleanup().catch(() => {
  console.error('Local photo cleanup did not finish. Remaining reservations can be retried.')
  process.exitCode = 1
})
