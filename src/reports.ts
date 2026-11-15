export const incidentLabels = {
  aggressive_behaviour: 'Aggressive behaviour',
  causing_disturbance: 'Causing a disturbance',
  intoxication: 'Intoxication',
  rule_violation: 'Breach of venue rules',
  other: 'Other',
} as const
export type IncidentType = keyof typeof incidentLabels
export const incidentTypes = Object.keys(incidentLabels) as IncidentType[]
export const severityLabels = { low: 'Low', medium: 'Medium', high: 'High' } as const
export const statusLabels = { pending_review: 'Awaiting review' } as const
export const roleLabels = { employee: 'Employee', manager: 'Manager' } as const
export type Role = keyof typeof roleLabels
const legacyIncidentCodes: Record<string, IncidentType> = {
  'Saldırgan davranış': 'aggressive_behaviour',
  'Rahatsızlık çıkarma': 'causing_disturbance',
  'Sarhoşluk': 'intoxication',
  'Mekân kurallarını ihlal': 'rule_violation',
  'Diğer': 'other',
}
const legacySeverityCodes: Record<string, string> = { 'Düşük': 'low', 'düşük': 'low', 'Orta': 'medium', 'orta': 'medium', 'Yüksek': 'high', 'yüksek': 'high' }
export function normalizeSeverity(value: unknown): unknown {
  return typeof value === 'string' && Object.hasOwn(legacySeverityCodes, value) ? legacySeverityCodes[value] : value
}
export const storageKey = 'teambrief.reports.v1'
export type Severity = keyof typeof severityLabels
export type ReportDraft = {
  label: string
  occurredAt: string
  incidentType: IncidentType | ''
  severity: Severity
  appearance: string
  description: string
}
export type Report = ReportDraft & { incidentType: IncidentType; id: string; createdAt: string; employee: 'Müslüm'; status: 'pending_review' }
export type FormErrors = Partial<Record<keyof ReportDraft, string>>

export function localDateTime(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
export function validateDraft(draft: ReportDraft, now = Date.now()): FormErrors {
  const errors: FormErrors = {}
  for (const field of ['label', 'appearance', 'description'] as const) {
    if (!draft[field].trim()) errors[field] = 'This field is required.'
  }
  const time = new Date(draft.occurredAt).getTime()
  if (!draft.occurredAt || !Number.isFinite(time)) errors.occurredAt = 'Choose a valid date and time.'
  else if (time > now) errors.occurredAt = 'The incident date and time cannot be in the future.'
  if (!Object.hasOwn(incidentLabels, draft.incidentType)) errors.incidentType = 'Select an incident type.'
  if (!Object.hasOwn(severityLabels, draft.severity)) errors.severity = 'Select a severity level.'
  return errors
}
export function parseReports(raw: string | null): Report[] {
  if (raw === null) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error('Invalid report data')
  const normalized = data.map(value => {
    if (!value || typeof value !== 'object') return value
    // Convert enum values only. Never trim, translate or rewrite user-entered text.
    return {
      ...value,
      incidentType: typeof value.incidentType === 'string' && Object.hasOwn(legacyIncidentCodes, value.incidentType) ? legacyIncidentCodes[value.incidentType] : value.incidentType,
      severity: normalizeSeverity(value.severity),
      status: value.status === 'İnceleme bekliyor' ? 'pending_review' : value.status,
    }
  })
  if (!normalized.every(isReport)) throw new Error('Invalid report data')
  return normalized
}
function isReport(value: unknown): value is Report {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return ['label', 'occurredAt', 'incidentType', 'severity', 'appearance', 'description', 'id', 'createdAt'].every(key => typeof r[key] === 'string' && (r[key] as string).trim().length > 0)
    && r.employee === 'Müslüm' && r.status === 'pending_review'
    && Number.isFinite(new Date(r.createdAt as string).getTime())
    && Object.keys(validateDraft(r as unknown as ReportDraft)).length === 0
}
export function newestFirst(reports: Report[]) {
  return [...reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export const formatDate = (value: string) => new Intl.DateTimeFormat('en-IE', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value))
