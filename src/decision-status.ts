import type { ServerDecision } from './backend.ts'

export const decisionStatusLabels = {
  'awaiting-review': 'Awaiting review',
  'active-ban': 'Active ban',
  'ban-lifted': 'Ban lifted',
  'no-ban': 'No ban required',
} as const

export function decisionStatus(decision: Pick<ServerDecision, 'kind' | 'liftedAt'> | null): keyof typeof decisionStatusLabels {
  if (!decision) return 'awaiting-review'
  if (decision.kind === 'no-ban') return 'no-ban'
  return decision.liftedAt ? 'ban-lifted' : 'active-ban'
}
