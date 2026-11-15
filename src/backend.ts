import type { SupabaseClient } from '@supabase/supabase-js'
import type { IncidentType, Severity, ReportDraft } from './reports.ts'
import type { DecisionDraft } from './decisions.ts'
export type Membership = { venueId: string; venueName: string; userId: string; role: 'employee' | 'manager'; name: string }
export type Incident = { id: string; label: string; occurredAt: string; createdAt: string; incidentType: IncidentType; severity: Severity; appearance: string; description: string; reportedBy: string }
export type Summary = Pick<Incident, 'label' | 'appearance' | 'incidentType' | 'occurredAt'> & { reportId: string; decisionId: string }
export type ServerDecision = { id: string; reportId: string; kind: 'ban' | 'no-ban'; explanation: string; severity: Severity | null; instruction: string | null; reviewAt: string | null; decidedBy: string; decidedAt: string; liftedAt: string | null; liftedBy: string | null; liftReason: string | null }
export type History = { id: string; decisionId: string; event: string; actorId: string; at: string; reason: string }
export type Data = { incidents: Incident[]; decisions: ServerDecision[]; summaries: Summary[]; history: History[] }
export const emptyData = (): Data => ({ incidents: [], decisions: [], summaries: [], history: [] })
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
    client.rpc('get_active_decision_incidents', { p_venue_id: member.venueId }),
    client.from('decision_history').select('*').eq('venue_id', member.venueId).order('occurred_at', { ascending: true }),
  ])
  const [incidents, decisions, summaries, history] = results.map(r => checked(r) ?? [])
  return { incidents: incidents.map(mapIncident), decisions: decisions.map(mapDecision), summaries: summaries.map((r: Row) => ({ decisionId: r.decision_id, reportId: r.report_id, label: r.label, appearance: r.appearance, occurredAt: r.occurred_at, incidentType: r.incident_type })), history: history.map((r: Row) => ({ id: r.id, decisionId: r.decision_id, event: r.event_type, actorId: r.actor_id, at: r.occurred_at, reason: r.reason })) }
}
export async function createIncident(client: SupabaseClient, venueId: string, d: ReportDraft) {
  return checked(await client.rpc('create_incident_report', { p_venue_id: venueId, p_label: d.label, p_occurred_at: new Date(d.occurredAt).toISOString(), p_incident_type: d.incidentType, p_severity: d.severity, p_appearance: d.appearance, p_description: d.description }))
}
export async function createDecision(client: SupabaseClient, venueId: string, reportId: string, d: DecisionDraft) {
  return checked(await client.rpc('create_decision', { p_venue_id: venueId, p_report_id: reportId, p_kind: d.kind, p_explanation: d.explanation, p_severity: d.kind === 'ban' ? d.severity : null, p_instruction: d.kind === 'ban' ? d.instruction : null, p_review_at: d.kind === 'ban' ? new Date(d.reviewAt).toISOString() : null }))
}
export async function liftDecision(client: SupabaseClient, venueId: string, id: string, reason: string) {
  return checked(await client.rpc('lift_service_ban', { p_venue_id: venueId, p_decision_id: id, p_reason: reason }))
}
