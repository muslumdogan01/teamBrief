function parseOrigin(value: string) {
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('Set VITE_SUPABASE_URL to a valid Supabase project URL.') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a Supabase project origin without credentials, a path, or query parameters.')
  }
  return url
}

export function localUrl(value: string) {
  const url = parseOrigin(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Local tools require an HTTP Supabase URL on localhost or 127.0.0.1.')
  }
  return url.origin
}

function isPublicKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return false
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'anon'
  } catch { return false }
}

export function clientConfig(value?: string, key?: string, allowLocal = false) {
  if (!value || !key) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY), then restart or rebuild the app.')
  }
  const url = parseOrigin(value)
  const host = url.hostname.replace(/\.$/, '')
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') ||
    host === '0.0.0.0' || host.startsWith('[')
  if (loopback) {
    if (!allowLocal) throw new Error('This build requires a hosted Supabase HTTPS URL. Use the Vite dev server for local Supabase.')
    localUrl(value)
  } else if (url.protocol !== 'https:') {
    throw new Error('Hosted Supabase requires an HTTPS project URL.')
  }
  if (!isPublicKey(key)) throw new Error('Use a publishable or anon client key. Privileged keys are not allowed.')
  return { url: url.origin, key, environment: loopback ? 'Local test environment' : 'Demo environment' }
}
