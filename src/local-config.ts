export function localUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Only a local Supabase URL (http://localhost or http://127.0.0.1) is allowed.')
  return url.origin
}
export function clientConfig(url?: string, key?: string) {
  if (!url || !key) throw new Error('Local Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then restart the app.')
  const origin = localUrl(url)
  if (!key.startsWith('sb_publishable_')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role !== 'anon') throw new Error()
    } catch { throw new Error('Use a publishable or anon client key. Privileged keys are not allowed.') }
  }
  return { url: origin, key }
}
