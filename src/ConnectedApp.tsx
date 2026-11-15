import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { clientConfig } from './local-config.ts'
import { checked, createDecision, createIncident, emptyData, liftDecision, loadData, memberships } from './backend.ts'
import type { Data, Incident, Membership, ServerDecision } from './backend.ts'
import { requestScope, runMutation } from './session-state.ts'
import { DecisionForm, LiftForm, ReportForm } from './App.tsx'
import { formatDate, incidentLabels, severityLabels } from './reports.ts'
import './App.css'

function message(e: unknown) { return e instanceof Error ? e.message : 'Unable to complete this request. Please try again.' }
export default function ConnectedApp() {
  const config = useMemo(() => {
    try {
      const c = clientConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
      return { client: createClient(c.url, c.key, { auth: {
        storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
        storageKey: 'teambrief.auth.local',
      } }) }
    }
    catch (e) { return { error: message(e) } }
  }, [])
  if (!config.client) return <main><h1>TeamBrief</h1><p className="error-banner" role="alert">{config.error}</p></main>
  return <AuthApp client={config.client} />
}
export function AuthApp({ client }: { client: SupabaseClient }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const signedOut = useRef(false)
  useEffect(() => {
    let alive = true
    const scope = requestScope()
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      scope.invalidate()
      if (signedOut.current && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return
      if (event === 'SIGNED_IN') signedOut.current = false
      if (alive) { setUser(session?.user ?? null); setLoading(false) }
    })
    const ticket = scope.ticket()
    client.auth.getSession().then(({ data, error }) => {
      if (alive && scope.current(ticket)) { setUser(data.session?.user ?? null); setError(error?.message ?? ''); setLoading(false) }
    }).catch(e => { if (alive && scope.current(ticket)) { setError(message(e)); setLoading(false) } })
    return () => { alive = false; scope.invalidate(); subscription.unsubscribe() }
  }, [client])
  async function logout() {
    // Unmount the account workspace before any network operation.
    signedOut.current = true
    setUser(null); setError('')
    try { checked(await client.auth.signOut({ scope: 'local' })) }
    catch { setError('Sign out failed. Please retry signing out.'); }
  }
  if (loading) return <main><h1>TeamBrief</h1><p role="status">Loading your session…</p></main>
  if (!user) return <Login client={client} error={error} retryLogout={logout} />
  return <Account key={user.id} client={client} user={user} logout={logout} />
}
export function Login({ client, error: external = '', retryLogout }: { client: SupabaseClient; error?: string; retryLogout?: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { checked<unknown>(await client.auth.signInWithPassword({ email, password })) }
    catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  return <main className="auth-page"><form className="panel report-form" onSubmit={submit}><h1>Sign in to TeamBrief</h1><p>Use your local team account. Access is assigned by your pub administrator.</p><div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div><div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>{(error || external) && <p role="alert" className="error-banner">{error || external}</p>}<button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>{external && retryLogout && <button type="button" onClick={retryLogout}>Retry sign out</button>}</form></main>
}
function Account({ client, user, logout }: { client: SupabaseClient; user: User; logout: () => Promise<void> }) {
  const [members, setMembers] = useState<Membership[] | null>(null)
  const [error, setError] = useState('')
  const [venue, setVenue] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    memberships(client, user.id).then(m => { if (alive) { setMembers(m); setVenue(m[0]?.venueId ?? '') } }).catch(e => { if (alive) setError(message(e)) })
    return () => { alive = false }
  }, [client, user.id, attempt])
  const member = members?.find(m => m.venueId === venue)
  return <><header className={member ? "topbar account-topbar" : "topbar"}><strong>TeamBrief · {user.email}</strong><button onClick={logout}>Sign out</button></header>{error ? <main><p role="alert" className="error-banner">{error}</p><button onClick={() => { setMembers(null); setError(''); setAttempt(n => n + 1) }}>Retry</button></main> : !members ? <main role="status">Loading pub membership…</main> : !member ? <main><h1>Access not granted</h1><p>Your account has no active pub membership. Ask your pub administrator to assign access.</p></main> : <>{members.length > 1 && <label className="pub-picker">Pub <select value={venue} onChange={e => setVenue(e.target.value)}>{members.map(m => <option key={m.venueId} value={m.venueId}>{m.venueName}</option>)}</select></label>}<Workspace key={member.venueId} client={client} member={member} /></>}</>
}
type Page = 'home' | 'create' | 'mine' | 'active' | 'review' | 'history'
function Workspace({ client, member }: { client: SupabaseClient; member: Membership }) {
  const [data, setData] = useState<Data>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState<Page>('home')
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const scope = useMemo(requestScope, [])
  const lifetime = useMemo(requestScope, [])
  const manager = member.role === 'manager'
  const [allowed, setAllowed] = useState(true)
  async function refresh() {
    const ticket = scope.invalidate()
    setError(''); setNotice('')
    try {
      const current = (await memberships(client, member.userId)).find(m => m.venueId === member.venueId && m.role === member.role)
      if (!current) { if (scope.current(ticket)) { setAllowed(false); setData(emptyData()) }; throw new Error('Your pub membership changed. Sign out and sign in again to refresh access.') }
      const next = await loadData(client, current)
      if (scope.current(ticket)) { setData(next); setAllowed(true) }
    } catch (e) { if (scope.current(ticket)) { setData(emptyData()); setError(message(e)) }; throw e }
    finally { if (scope.current(ticket)) setLoading(false) }
  }
  useEffect(() => {
    void refresh().catch(() => {})
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh().catch(() => {}) }, 15000)
    const focus = () => { void refresh().catch(() => {}) }
    window.addEventListener('focus', focus)
    return () => { scope.invalidate(); lifetime.invalidate(); window.clearInterval(timer); window.removeEventListener('focus', focus) }
  // A workspace is keyed by user and pub; cleanup invalidates all pending results.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, member.venueId, member.userId, scope])
  async function mutate(write: () => Promise<unknown>, next: Page): Promise<string | null> {
    const ticket = lifetime.ticket(); setNotice('')
    try {
      await runMutation(write, async () => { if (!lifetime.current(ticket)) throw new Error('Account changed.'); await refresh() })
      // Refresh starts a new generation; unmounted workspaces cannot publish data.
      if (lifetime.current(ticket)) { setNotice('Saved successfully.'); setSelected(null); setPage(next) }
      return null
    } catch (e) { const failure = message(e); if (lifetime.current(ticket) && failure.startsWith('Saved, but')) setError(failure); return failure }
  }
  const mine = data.incidents.filter(r => r.reportedBy === member.userId)
  const pending = data.incidents.filter(r => !data.decisions.some(d => d.reportId === r.id))
  const active = data.decisions.filter(d => d.kind === 'ban' && !d.liftedAt)
  const incident = data.incidents.find(r => r.id === selected)
  const decision = data.decisions.find(d => d.id === selected || d.reportId === selected)
  const titles: Record<Page, string> = { home: 'Home', create: 'Report Incident', mine: 'My Incidents', active: 'Active Decisions', review: 'Management', history: 'Decision history' }
  function navigate(p: Page) { setPage(p); setSelected(null); setNotice('') }
  function decisionView(d: ServerDecision) {
    return <section className="panel detail"><h2>{d.kind === 'no-ban' ? 'No ongoing ban required' : d.liftedAt ? 'Service ban lifted' : 'Active service ban'}</h2><p>{d.explanation}</p><p>Decided by account: {d.decidedBy} · {formatDate(d.decidedAt)}</p>{d.kind === 'ban' && <><p className="service-instruction">{d.instruction}</p><p>{severityLabels[d.severity!]} severity · Review due: {formatDate(d.reviewAt!)}</p>{!d.liftedAt && Date.parse(d.reviewAt!) <= now && <p className="review-warning">Review overdue. The ban remains active until a manager lifts it.</p>}<p className="info-note">Low severity does not permit service. Follow the service instructions.</p>{d.liftedAt ? <p>Lifted by account {d.liftedBy} · {formatDate(d.liftedAt)} · {d.liftReason}</p> : manager && <LiftForm key={d.id} onSave={reason => mutate(() => liftDecision(client, member.venueId, d.id, reason), page)} />}</>}<h3>Decision history</h3>{data.history.filter(h => h.decisionId === d.id).map(h => <p key={h.id}>{h.event} · {formatDate(h.at)} · Account {h.actorId} · {h.reason}</p>)}{!data.history.some(h => h.decisionId === d.id) && <p>History is available to the reporting employee and pub managers.</p>}</section>
  }
  function list(items: Incident[]) { return items.length ? <ul className="report-list">{items.map(r => <li key={r.id}><button className="report-row" onClick={() => setSelected(r.id)}><strong>{r.label}</strong><span>{formatDate(r.occurredAt)}</span></button></li>)}</ul> : <p className="empty">No incidents to show.</p> }
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('home') }}>TeamBrief</a><p>{member.venueName}</p><nav aria-label="Main navigation" style={{ '--nav-count': manager ? 6 : 4 } as React.CSSProperties}>{(Object.keys(titles) as Page[]).filter(p => manager || !['review', 'history'].includes(p)).map(p => <button key={p} className={page === p ? 'nav-item active' : 'nav-item'} onClick={() => navigate(p)}>{titles[p]}</button>)}</nav><div className="profile">{member.name} · {manager ? 'Manager' : 'Staff'}</div></aside><div className="workspace"><main><h1>{titles[page]}</h1><p className="storage-note">Connected to local Supabase · {member.venueName}</p><button onClick={() => { void refresh().catch(() => {}) }}>Refresh</button>{error && <p className="error-banner" role="alert">{error}</p>}{notice && <p className="success-banner" role="status">{notice}</p>}{loading ? <p role="status">Loading team records…</p> : error || !allowed ? <p>Records are unavailable. Refresh to try again.</p> : <>
    {page === 'home' && <><div className="stats"><div><span>My incidents</span><strong>{mine.length}</strong></div><div><span>Active bans</span><strong>{active.length}</strong></div>{manager && <div><span>Awaiting review</span><strong>{pending.length}</strong></div>}</div><button className="primary" onClick={() => navigate('create')}>Report incident</button></>}
    {page === 'create' && <ReportForm actor={member.name} onSave={draft => mutate(() => createIncident(client, member.venueId, draft), 'mine')} />}
    {(page === 'mine' || page === 'review') && (incident ? <><button onClick={() => setSelected(null)}>← Back</button><FullIncident incident={incident} />{decision ? decisionView(decision) : page === 'review' && manager ? <DecisionForm actor={member.name} key={incident.id} onSave={draft => mutate(() => createDecision(client, member.venueId, incident.id, draft), 'review')} /> : <p>Awaiting review.</p>}</> : list(page === 'mine' ? mine : pending))}
    {page === 'active' && <><p className="info-note">Reaching the review date does not automatically lift a ban.</p>{decision && !decision.liftedAt ? <><button onClick={() => setSelected(null)}>← Back</button>{(() => { const s = data.summaries.find(s => s.decisionId === decision.id); return s ? <section className="panel detail"><h2>{s.label}</h2><p>{s.appearance}</p><p>{incidentLabels[s.incidentType]} · {formatDate(s.occurredAt)}</p></section> : <p>Person summary unavailable. Refresh the list.</p> })()}{decisionView(decision)}</> : active.length ? <ul className="report-list">{active.map(d => <li key={d.id}><button className="report-row" onClick={() => setSelected(d.id)}><strong>{data.summaries.find(s => s.decisionId === d.id)?.label ?? 'Person summary unavailable'}</strong><span>{d.instruction}</span><span>Review due: {formatDate(d.reviewAt!)}</span>{Date.parse(d.reviewAt!) <= now && <span className="review-warning">Review overdue</span>}</button></li>)}</ul> : <p className="empty">No active service bans.</p>}</>}
    {page === 'history' && manager && (decision ? <><button onClick={() => setSelected(null)}>← Back</button>{decisionView(decision)}</> : data.decisions.length ? <ul className="report-list">{data.decisions.map(d => <li key={d.id}><button className="report-row" onClick={() => setSelected(d.id)}><strong>{data.incidents.find(r => r.id === d.reportId)?.label ?? 'Incident'}</strong><span>{d.explanation}</span><span>{formatDate(d.decidedAt)}</span></button></li>)}</ul> : <p className="empty">No decisions yet.</p>)}
  </>}</main></div></div>
}
function FullIncident({ incident: r }: { incident: Incident }) {
  return <section className="panel detail"><h2>{r.label}</h2><dl><div><dt>Reported by account</dt><dd>{r.reportedBy}</dd></div><div><dt>Incident time</dt><dd>{formatDate(r.occurredAt)}</dd></div><div><dt>Incident type</dt><dd>{incidentLabels[r.incidentType]}</dd></div><div><dt>Suggested severity</dt><dd>{severityLabels[r.severity]}</dd></div><div className="wide"><dt>Identifying description</dt><dd>{r.appearance}</dd></div><div className="wide"><dt>Incident description</dt><dd>{r.description}</dd></div></dl></section>
}
