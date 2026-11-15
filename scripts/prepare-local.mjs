import { createClient } from '@supabase/supabase-js'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { accounts, localSettings, localTestPassword, sql, venueId } from './local-tools.mjs'
async function main() {
  const password = localTestPassword()
  const { url, anon, admin } = localSettings()
  if (!anon || !admin) throw new Error('Local Supabase client/admin credentials are unavailable.')
  const client = createClient(url, admin, { auth: { persistSession: false, autoRefreshToken: false } })
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error('Unable to list local test users.')
    users.push(...data.users)
    if (data.users.length < 100) break
  }
  const prepared = []
  for (const account of accounts) {
    let user = users.find(u => u.email === account.email)
    if (user && user.app_metadata.teambrief_fixture !== true) throw new Error('An existing account conflicts with a test email; no changes made to that account.')
    if (!user) {
      const { data, error } = await client.auth.admin.createUser({ email: account.email, password, email_confirm: true, app_metadata: { teambrief_fixture: true } })
      if (error) throw new Error('Unable to create a local test user.')
      user = data.user
    }
    if (!user || !/^[a-f0-9-]{36}$/.test(user.id)) throw new Error('Invalid local user ID.')
    prepared.push({ ...account, id: user.id })
  }
  sql(`begin;\ninsert into public.venues(id,name) values ('${venueId}','The Example Pub') on conflict(id) do nothing;\n` + prepared.map(a => `update public.profiles set display_name = '${a.name}' where id = '${a.id}';\ninsert into public.venue_memberships(venue_id,user_id,role,is_active) values ('${venueId}','${a.id}','${a.role}',true) on conflict(venue_id,user_id) do update set role=excluded.role,is_active=true;`).join('\n') + '\ncommit;')
  const existing = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
  const other = existing.split('\n').filter(l => !/^VITE_SUPABASE_(URL|ANON_KEY)=/.test(l)).join('\n').trim()
  writeFileSync('.env.local', `${other ? other + '\n' : ''}VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${anon}\n`, { mode: 0o600 })
  chmodSync('.env.local', 0o600)
  console.log('Local pub and three test memberships are ready. Client configuration saved privately to .env.local. No incident records were changed.')
}
main().catch(() => { console.error('Local preparation failed. Check local Supabase/Docker availability and fixture account conflicts. Credentials suppressed.'); process.exitCode = 1 })
