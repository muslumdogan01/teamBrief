import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { clientConfig } from './src/supabase-config.ts'

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_')
  let config
  try {
    config = clientConfig(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY,
      command === 'serve' && !isPreview,
    )
  } catch (error) {
    config = { error: error instanceof Error ? error.message : 'Supabase configuration is invalid.' }
  }

  return {
    plugins: [
      react(),
      {
        name: 'teambrief-hosted-auth-default',
        apply: 'build',
        transform(code, id) {
          if (!/\/@supabase\/auth-js\/dist\/(module|main)\/lib\/constants\.js$/.test(id)) return
          // SupabaseClient always supplies the validated Auth URL explicitly.
          return code.replace('http://localhost:9999', 'https://unused.invalid')
        },
      },
    ],
    envPrefix: [],
    define: { 'import.meta.env.TEAMBRIEF_SUPABASE': JSON.stringify(config) },
  }
})
