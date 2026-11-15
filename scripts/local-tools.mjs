import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { localUrl } from '../src/local-config.ts'
const dockerPath = '/Applications/Docker.app/Contents/Resources/bin'
export const toolEnv = { ...process.env, PATH: `${dockerPath}:${process.env.PATH}` }
export function localSettings() {
  // No --project-ref, --linked or remote database options are accepted.
  const output = execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { env: toolEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const settings = JSON.parse(output)
  const url = localUrl(settings.API_URL)
  return { url, anon: settings.ANON_KEY ?? settings.PUBLISHABLE_KEY, admin: settings.SERVICE_ROLE_KEY ?? settings.SECRET_KEY }
}
export function sql(command) {
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('Remote Docker hosts are not allowed.')
  const docker = existsSync(`${dockerPath}/docker`) ? `${dockerPath}/docker` : 'docker'
  const endpoint = execFileSync(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env: toolEnv, encoding: 'utf8' }).trim()
  if (!endpoint.startsWith('unix://')) throw new Error('Only a local Docker socket is allowed.')
  return execFileSync(docker, ['exec', '-i', 'supabase_db_teambrief', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { env: toolEnv, input: command, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}
export const accounts = [
  { email: 'staff1@teambrief.test', name: 'Jamie Example', role: 'staff' },
  { email: 'staff2@teambrief.test', name: 'Taylor Example', role: 'staff' },
  { email: 'manager@teambrief.test', name: 'Morgan Example', role: 'manager' },
]
export function localTestPassword() {
  if (existsSync('.env.test.local')) process.loadEnvFile('.env.test.local')
  const value = process.env.TEAMBRIEF_LOCAL_TEST_PASSWORD
  if (!value || value.length < 12) throw new Error('Set TEAMBRIEF_LOCAL_TEST_PASSWORD in ignored .env.test.local (at least 12 characters).')
  return value
}
export const venueId = '30000000-0000-0000-0000-000000000001'
