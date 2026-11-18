import type { SupabaseClient } from '@supabase/supabase-js'
import type { IncidentType, Severity, ReportDraft } from './reports.ts'
import type { DecisionDraft } from './decisions.ts'
export type Membership = { venueId: string; venueName: string; userId: string; role: 'employee' | 'manager'; name: string }
export type Incident = { id: string; label: string; occurredAt: string; createdAt: string; incidentType: IncidentType; severity: Severity; appearance: string; description: string; reportedBy: string }
export type ServerDecision = { id: string; reportId: string; kind: 'ban' | 'no-ban'; explanation: string; severity: Severity | null; instruction: string | null; reviewAt: string | null; decidedBy: string; decidedAt: string; liftedAt: string | null; liftedBy: string | null; liftReason: string | null }
export type History = { id: string; decisionId: string; event: string; actorId: string; at: string; reason: string }
export type VenueUpdate = { id: string; eventType: 'ban_lifted'; personLabel: string; serviceNote: string; occurredAt: string; readAt: string | null }
export type IncidentPhotoRef = { reportId: string; path: string }
export type Data = { incidents: Incident[]; decisions: ServerDecision[]; history: History[]; updates: VenueUpdate[]; photos: IncidentPhotoRef[] }
export const emptyData = (): Data => ({ incidents: [], decisions: [], history: [], updates: [], photos: [] })
type Row = Record<string, any>
export const mapIncident = (r: Row): Incident => ({ id: r.id, label: r.label, occurredAt: r.occurred_at, createdAt: r.created_at, incidentType: r.incident_type, severity: r.severity, appearance: r.appearance, description: r.description, reportedBy: r.reported_by })
export const mapDecision = (r: Row): ServerDecision => ({ id: r.id, reportId: r.report_id, kind: r.kind, explanation: r.explanation, severity: r.severity, instruction: r.instruction, reviewAt: r.review_at, decidedBy: r.decided_by, decidedAt: r.decided_at, liftedAt: r.lifted_at, liftedBy: r.lifted_by, liftReason: r.lift_reason })
export function checked<T>({ data, error }: { data?: T; error: { message: string } | null }): T { if (error) throw new Error(error.message); return data as T }
export async function memberships(client: SupabaseClient, userId: string): Promise<Membership[]> {
  const rows = checked(await client.from('venue_memberships').select('venue_id,role,venues(name)').eq('user_id', userId).eq('is_active', true)) ?? []
  const profile = checked<Row | null>(await client.from('profiles').select('display_name').eq('id', userId).single())
  return rows.map((r: Row) => ({ venueId: r.venue_id, venueName: r.venues.name, userId, role: r.role === 'manager' ? 'manager' : 'employee', name: profile?.display_name ?? 'Team member' }))
}
export async function loadData(client: SupabaseClient, member: Membership): Promise<Data> {
  // Staff never request cross-author full incidents, even though RLS also protects them.
  let reports = client.from('incident_reports').select('*').eq('venue_id', member.venueId)
  if (member.role !== 'manager') reports = reports.eq('reported_by', member.userId)
  const results = await Promise.all([
    reports.order('created_at', { ascending: false }),
    client.from('decisions').select('*').eq('venue_id', member.venueId).order('decided_at', { ascending: false }),
    client.rpc('get_recent_updates', { p_venue_id: member.venueId }),
    client.from('incident_photos').select('report_id,object_path').eq('venue_id', member.venueId),
    client.from('decision_history').select('*').eq('venue_id', member.venueId).order('occurred_at', { ascending: true }),
  ])
  const [incidents, decisions, updates, photos, history] = results.map(r => checked(r) ?? [])
  return { photos: photos.map((r: Row) => ({ reportId: r.report_id, path: r.object_path })), updates: updates.map((r: Row) => ({ id: r.id, eventType: r.event_type, personLabel: r.person_label, serviceNote: r.service_note, occurredAt: r.occurred_at, readAt: r.read_at })), incidents: incidents.map(mapIncident), decisions: decisions.map(mapDecision), history: history.map((r: Row) => ({ id: r.id, decisionId: r.decision_id, event: r.event_type, actorId: r.actor_id, at: r.occurred_at, reason: r.reason })) }
}
export async function createIncident(client: SupabaseClient, venueId: string, d: ReportDraft) {
  return checked(await client.rpc('create_incident_report', { p_venue_id: venueId, p_label: d.label, p_occurred_at: new Date(d.occurredAt).toISOString(), p_incident_type: d.incidentType, p_severity: d.severity, p_appearance: d.appearance, p_description: d.description }))
}
export async function createDecision(client: SupabaseClient, venueId: string, reportId: string, d: DecisionDraft) {
  return checked(await client.rpc('create_decision', { p_venue_id: venueId, p_report_id: reportId, p_kind: d.kind, p_explanation: d.explanation, p_severity: d.kind === 'ban' ? d.severity : null, p_instruction: d.kind === 'ban' ? d.instruction : null, p_review_at: d.kind === 'ban' ? new Date(d.reviewAt).toISOString() : null }))
}
export async function liftDecision(client: SupabaseClient, venueId: string, id: string, reason: string, serviceNote: string) {
  return checked(await client.rpc('lift_service_ban', { p_venue_id: venueId, p_decision_id: id, p_reason: reason, p_service_note: serviceNote }))
}
export async function markUpdateRead(client: SupabaseClient, venueId: string, updateId: string) {
  return checked(await client.rpc('mark_venue_update_read', { p_venue_id: venueId, p_update_id: updateId }))
}

export type TeamTotals = { active_bans: number; my_incidents: number; awaiting_review: number | null }
export async function loadTeamTotals(client: SupabaseClient, venueId: string) {
  return checked(await client.rpc('get_teambrief_totals', { p_venue_id: venueId }).single<TeamTotals>())
}

export type BanCursor = { decided_at: string; decision_id: string }
export type ActiveBan = BanCursor & {
  report_id: string; label: string; appearance: string; severity: Severity
  instruction: string; review_at: string; photo_path: string | null
}

export async function findActiveBans(
  client: SupabaseClient, venueId: string, query: string, limit: number, signal: AbortSignal,
  cursor?: BanCursor, decisionId?: string,
) {
  const rows = checked(await client.rpc('find_active_bans', {
    p_venue_id: venueId, p_query: query, p_limit: limit,
    p_before_at: cursor?.decided_at ?? null, p_before_id: cursor?.decision_id ?? null,
    p_decision_id: decisionId ?? null,
  }).abortSignal(signal)) as (ActiveBan & { has_more: boolean })[] | null
  const last = rows?.at(-1)
  return { items: rows ?? [], next: last?.has_more ? { decided_at: last.decided_at, decision_id: last.decision_id } : undefined }
}
