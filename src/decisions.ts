import { parseReports, storageKey, severityLabels } from './reports.ts'
import type { Report, Severity } from './reports.ts'

export type Profile = 'employee' | 'manager'
export type DecisionDraft = { kind: 'ban' | 'no-ban'; explanation: string; severity: Severity; instruction: string; reviewAt: string }
type BaseDecision = { id: string; reportId: string; explanation: string; manager: 'Alex'; decidedAt: string }
export type Decision = BaseDecision & ({ kind: 'no-ban' } | { kind: 'ban'; severity: Severity; instruction: string; reviewAt: string; lifted?: { reason: string; manager: 'Alex'; at: string } })
export type Store = { version: 2; reports: Report[]; decisions: Decision[] }
export const currentStorageKey = 'teambrief.data.v2'
export function validateDecision(draft: DecisionDraft, now = Date.now()) {
  const errors: Partial<Record<keyof DecisionDraft, string>> = {}
  if (!draft.explanation.trim()) errors.explanation = 'Karar açıklaması zorunludur.'
  if (draft.kind !== 'ban' && draft.kind !== 'no-ban') errors.kind = 'Karar türü seçin.'
  if (draft.kind === 'ban') {
    if (!Object.hasOwn(severityLabels, draft.severity)) errors.severity = 'Son önem derecesini seçin.'
    if (!draft.instruction.trim()) errors.instruction = 'Personel için servis talimatı yazın.'
    if (!draft.reviewAt || !Number.isFinite(Date.parse(draft.reviewAt)) || Date.parse(draft.reviewAt) <= now) errors.reviewAt = 'Gelecekte bir gözden geçirme tarihi ve saati seçin.'
  }
  return errors
}
export const activeBans = (store: Store) => store.decisions.filter((d): d is Decision & { kind: 'ban' } => d.kind === 'ban' && !d.lifted)
export const pendingReports = (store: Store) => store.reports.filter(r => !store.decisions.some(d => d.reportId === r.id))
export const reviewDue = (decision: Decision, now = Date.now()) => decision.kind === 'ban' && !decision.lifted && Date.parse(decision.reviewAt) <= now
export function addDecision(store: Store, profile: Profile, reportId: string, draft: DecisionDraft, now = Date.now()): Store {
  if (profile !== 'manager') throw new Error('Bu işlem yalnızca yönetici demo görünümünde kullanılabilir.')
  if (!store.reports.some(r => r.id === reportId)) throw new Error('Bildirim bulunamadı.')
  if (store.decisions.some(d => d.reportId === reportId)) throw new Error('Bu bildirim için zaten bir karar kaydedilmiş. Listeyi yenileyin.')
  if (Object.keys(validateDecision(draft, now)).length) throw new Error('Karar alanlarını kontrol edin.')
  const base: BaseDecision = { id: crypto.randomUUID(), reportId, explanation: draft.explanation.trim(), manager: 'Alex', decidedAt: new Date(now).toISOString() }
  const decision: Decision = draft.kind === 'ban'
    ? { ...base, kind: 'ban', severity: draft.severity, instruction: draft.instruction.trim(), reviewAt: new Date(draft.reviewAt).toISOString() }
    : { ...base, kind: 'no-ban' }
  return { ...store, decisions: [...store.decisions, decision] }
}
export function liftBan(store: Store, profile: Profile, id: string, reason: string, now = Date.now()): Store {
  if (profile !== 'manager') throw new Error('Bu işlem yalnızca yönetici demo görünümünde kullanılabilir.')
  if (!reason.trim()) throw new Error('Yasağı kaldırma gerekçesi zorunludur.')
  const ban = activeBans(store).find(d => d.id === id)
  if (!ban) throw new Error('Aktif yasak bulunamadı. Listeyi yenileyin.')
  return { ...store, decisions: store.decisions.map(d => d.id === id ? { ...ban, lifted: { reason: reason.trim(), manager: 'Alex', at: new Date(now).toISOString() } } : d) }
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
  const data = JSON.parse(raw) as Store
  if (!data || data.version !== 2 || !Array.isArray(data.decisions) || !data.decisions.every(validDecision)) throw new Error('Karar kayıtları okunamadı.')
  const reports = parseReports(JSON.stringify(data.reports))
  if (new Set(reports.map(r => r.id)).size !== reports.length || new Set(data.decisions.map(d => d.id)).size !== data.decisions.length || new Set(data.decisions.map(d => d.reportId)).size !== data.decisions.length || data.decisions.some(d => !reports.some(r => r.id === d.reportId))) throw new Error('Kayıt ilişkileri geçersiz.')
  return { version: 2, reports, decisions: data.decisions }
}
export function loadStore(storage: Pick<Storage, 'getItem' | 'setItem'>): Store {
  const current = storage.getItem(currentStorageKey)
  if (current !== null) return parseStore(current)
  // Keep the original v1 key untouched as a migration backup.
  const migrated: Store = { version: 2, reports: parseReports(storage.getItem(storageKey)), decisions: [] }
  storage.setItem(currentStorageKey, JSON.stringify(migrated))
  return migrated
}
export function writeStore(storage: Pick<Storage, 'setItem'>, store: Store) {
  storage.setItem(currentStorageKey, JSON.stringify(store))
}
