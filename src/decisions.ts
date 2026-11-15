import { parseReports, storageKey, severityLabels, normalizeSeverity } from './reports.ts'
import type { Report, Severity, Role } from './reports.ts'

export type Profile = Role
export type DecisionDraft = { kind: 'ban' | 'no-ban'; explanation: string; severity: Severity; instruction: string; reviewAt: string }
type BaseDecision = { id: string; reportId: string; explanation: string; manager: 'Alex'; decidedAt: string }
export type Decision = BaseDecision & ({ kind: 'no-ban' } | { kind: 'ban'; severity: Severity; instruction: string; reviewAt: string; lifted?: { reason: string; manager: 'Alex'; at: string } })
export type Store = { version: 3; reports: Report[]; decisions: Decision[] }
export const legacyStorageKey = 'teambrief.data.v2'
export const currentStorageKey = 'teambrief.data.v3'
export function validateDecision(draft: DecisionDraft, now = Date.now()) {
  const errors: Partial<Record<keyof DecisionDraft, string>> = {}
  if (!draft.explanation.trim()) errors.explanation = 'Please give a reason for the decision.'
  if (draft.kind !== 'ban' && draft.kind !== 'no-ban') errors.kind = 'Select a decision.'
  if (draft.kind === 'ban') {
    if (!Object.hasOwn(severityLabels, draft.severity)) errors.severity = 'Select the final severity.'
    if (!draft.instruction.trim()) errors.instruction = 'Provide service instructions for staff.'
    if (!draft.reviewAt || !Number.isFinite(Date.parse(draft.reviewAt)) || Date.parse(draft.reviewAt) <= now) errors.reviewAt = 'Choose a future review date and time.'
  }
  return errors
}
export const activeBans = (store: Store) => store.decisions.filter((d): d is Decision & { kind: 'ban' } => d.kind === 'ban' && !d.lifted)
export const pendingReports = (store: Store) => store.reports.filter(r => !store.decisions.some(d => d.reportId === r.id))
export const reviewDue = (decision: Decision, now = Date.now()) => decision.kind === 'ban' && !decision.lifted && Date.parse(decision.reviewAt) <= now
export function addDecision(store: Store, profile: Profile, reportId: string, draft: DecisionDraft, now = Date.now()): Store {
  if (profile !== 'manager') throw new Error('This action is only available in the manager demo profile.')
  if (!store.reports.some(r => r.id === reportId)) throw new Error('Report not found.')
  if (store.decisions.some(d => d.reportId === reportId)) throw new Error('A decision has already been recorded for this report. Refresh the list.')
  if (Object.keys(validateDecision(draft, now)).length) throw new Error('Please check the decision fields.')
  const base: BaseDecision = { id: crypto.randomUUID(), reportId, explanation: draft.explanation, manager: 'Alex', decidedAt: new Date(now).toISOString() }
  const decision: Decision = draft.kind === 'ban'
    ? { ...base, kind: 'ban', severity: draft.severity, instruction: draft.instruction, reviewAt: new Date(draft.reviewAt).toISOString() }
    : { ...base, kind: 'no-ban' }
  return { ...store, decisions: [...store.decisions, decision] }
}
export function liftBan(store: Store, profile: Profile, id: string, reason: string, now = Date.now()): Store {
  if (profile !== 'manager') throw new Error('This action is only available in the manager demo profile.')
  if (!reason.trim()) throw new Error('Please give a reason for lifting the ban.')
  const ban = activeBans(store).find(d => d.id === id)
  if (!ban) throw new Error('Active ban not found. Refresh the list.')
  return { ...store, decisions: store.decisions.map(d => d.id === id ? { ...ban, lifted: { reason: reason, manager: 'Alex', at: new Date(now).toISOString() } } : d) }
}
function validDecision(value: unknown): value is Decision {
  if (!value || typeof value !== 'object') return false
  const d = value as Decision
  const text = (v: unknown) => typeof v === 'string' && Boolean(v.trim())
  const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v as string))
  if (!text(d.id) || !text(d.reportId) || !text(d.explanation) || d.manager !== 'Alex' || !date(d.decidedAt)) return false
  if (d.kind === 'no-ban') return true
  return d.kind === 'ban' && Object.hasOwn(severityLabels, d.severity) && text(d.instruction) && date(d.reviewAt)
    && Date.parse(d.reviewAt) > Date.parse(d.decidedAt)
    && (!d.lifted || (text(d.lifted.reason) && d.lifted.manager === 'Alex' && date(d.lifted.at)))
}
export function parseStore(raw: string): Store {
  const data = JSON.parse(raw)
  if (!data || ![2, 3].includes(data.version) || !Array.isArray(data.decisions)) throw new Error('Unable to read decision records.')
  data.decisions = data.decisions.map((d: unknown) => {
    if (!d || typeof d !== 'object') return d
    const record = d as Record<string, unknown>
    return record.kind === 'ban' ? { ...record, severity: normalizeSeverity(record.severity) } : record
  })
  if (!data.decisions.every(validDecision)) throw new Error('Unable to read decision records.')
  const decisions = data.decisions as Decision[]
  const reports = parseReports(JSON.stringify(data.reports))
  if (new Set(reports.map(r => r.id)).size !== reports.length || new Set(decisions.map(d => d.id)).size !== decisions.length || new Set(decisions.map(d => d.reportId)).size !== decisions.length || decisions.some(d => !reports.some(r => r.id === d.reportId))) throw new Error('Invalid record references.')
  return { version: 3, reports, decisions }
}
export function loadStore(storage: Pick<Storage, 'getItem' | 'setItem'>): Store {
  const current = storage.getItem(currentStorageKey)
  if (current !== null) return parseStore(current)
  // Preserve both legacy keys byte-for-byte as migration backups.
  const legacy = storage.getItem(legacyStorageKey)
  const migrated: Store = legacy !== null
    ? parseStore(legacy)
    : { version: 3, reports: parseReports(storage.getItem(storageKey)), decisions: [] }
  storage.setItem(currentStorageKey, JSON.stringify(migrated))
  return migrated
}
export function writeStore(storage: Pick<Storage, 'setItem'>, store: Store) {
  storage.setItem(currentStorageKey, JSON.stringify(store))
}
