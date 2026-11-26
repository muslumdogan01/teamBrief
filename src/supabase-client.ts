import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { clientConfig } from './supabase-config.ts'

type Settings = ReturnType<typeof clientConfig>
type ClientEntry = { settings: Settings; client: SupabaseClient }
export type BrowserConfig = { client: SupabaseClient; environment: string } | { error: string }

let entry: ClientEntry | undefined = import.meta.hot?.data.entry
const settings: Settings | { error: string } = import.meta.env.TEAMBRIEF_SUPABASE

export function getBrowserConfig(): BrowserConfig {
  if ('error' in settings) return settings

  const { url, key, environment } = settings
  try {
    if (entry?.settings.url !== url || entry.settings.key !== key || entry.settings.environment !== environment) {
      const storageKey = environment === 'Local test environment'
        ? 'teambrief.auth.local'
        : `teambrief.auth.${new URL(url).host}`
      entry = { settings, client: createClient(url, key, { auth: { storage: window.sessionStorage, storageKey } }) }
    }
    return { client: entry.client, environment }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to complete this request. Please try again.' }
  }
}

import.meta.hot?.dispose(data => { data.entry = entry })
