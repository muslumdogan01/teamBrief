export const incidentTypes = ['Saldırgan davranış', 'Rahatsızlık çıkarma', 'Sarhoşluk', 'Mekân kurallarını ihlal', 'Diğer'] as const
export const severityLabels = { low: 'Düşük', medium: 'Orta', high: 'Yüksek' } as const
export const storageKey = 'teambrief.reports.v1'
export type Severity = keyof typeof severityLabels
export type ReportDraft = {
  label: string
  occurredAt: string
  incidentType: string
  severity: Severity
  appearance: string
  description: string
}
export type Report = ReportDraft & { id: string; createdAt: string; employee: 'Müslüm'; status: 'İnceleme bekliyor' }
export type FormErrors = Partial<Record<keyof ReportDraft, string>>

export function localDateTime(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
export function validateDraft(draft: ReportDraft, now = Date.now()): FormErrors {
  const errors: FormErrors = {}
  for (const field of ['label', 'appearance', 'description'] as const) {
    if (!draft[field].trim()) errors[field] = 'Bu alanı boş bırakmayın.'
  }
  const time = new Date(draft.occurredAt).getTime()
  if (!draft.occurredAt || !Number.isFinite(time)) errors.occurredAt = 'Geçerli bir tarih ve saat seçin.'
  else if (time > now) errors.occurredAt = 'Olay tarihi ve saati gelecekte olamaz.'
  if (!incidentTypes.some(type => type === draft.incidentType)) errors.incidentType = 'Bir olay türü seçin.'
  if (!Object.hasOwn(severityLabels, draft.severity)) errors.severity = 'Bir önem derecesi seçin.'
  return errors
}
export function parseReports(raw: string | null): Report[] {
  if (raw === null) return []
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || !data.every(isReport)) throw new Error('Geçersiz kayıt')
  return data
}
function isReport(value: unknown): value is Report {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return ['label', 'occurredAt', 'incidentType', 'severity', 'appearance', 'description', 'id', 'createdAt'].every(key => typeof r[key] === 'string' && (r[key] as string).trim().length > 0)
    && r.employee === 'Müslüm' && r.status === 'İnceleme bekliyor'
    && Number.isFinite(new Date(r.createdAt as string).getTime())
    && Object.keys(validateDraft(r as unknown as ReportDraft)).length === 0
}
export function newestFirst(reports: Report[]) {
  return [...reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
