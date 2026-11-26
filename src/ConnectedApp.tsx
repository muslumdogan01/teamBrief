import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { BrowserConfig } from './supabase-client.ts'
import { checked, createDecision, emptyData, liftDecision, loadData, loadTeamTotals, memberships } from './backend.ts'
import type { Data, Incident, Membership, ServerDecision, TeamTotals } from './backend.ts'
import { discardIncidentPhoto, submitIncident } from './incident-photo-backend.ts'
import type { PhotoSubmission } from './incident-photo-backend.ts'
import { ActiveBanDetail, ActiveBanDirectory } from './ActiveBanDirectory.tsx'
import { Updates } from './Updates.tsx'
import { IncidentPhoto } from './IncidentPhoto.tsx'
import { requestScope, runMutation } from './session-state.ts'
import { DecisionForm, LiftForm, ReportForm } from './App.tsx'
import { decisionStatus, decisionStatusLabels } from './decision-status.ts'
import { formatDate, incidentLabels, severityLabels } from './reports.ts'
import './App.css'

function message(e: unknown) { return e instanceof Error ? e.message : 'Unable to complete this request. Please try again.' }
export default function ConnectedApp({ config }: { config: BrowserConfig }) {
  if ('error' in config) return <main><h1>TeamBrief</h1><p className="error-banner" role="alert">{config.error}</p></main>
  return <AuthApp client={config.client} environment={config.environment} />
}
export function AuthApp({ client, environment }: { client: SupabaseClient; environment: string }) {
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
  if (!user) return <Login client={client} environment={environment} error={error} retryLogout={logout} />
  return <SignedInWorkspace key={user.id} client={client} environment={environment} user={user} logout={logout} />
}
export function Login({ client, environment, error: external = '', retryLogout }: { client: SupabaseClient; environment: string; error?: string; retryLogout?: () => Promise<void> }) {
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
  return <main className="auth-page"><form className="panel report-form" onSubmit={submit}><h1>Sign in to TeamBrief</h1><p>{environment}</p><p>Sign in with the account provided by your pub administrator.</p><div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div><div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>{(error || external) && <p role="alert" className="error-banner">{error || external}</p>}<button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>{external && retryLogout && <button type="button" onClick={retryLogout}>Retry sign out</button>}</form></main>
}
function SignedInWorkspace({ client, user, logout, environment }: { client: SupabaseClient; environment: string; user: User; logout: () => Promise<void> }) {
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
  if (member) {
    return <Workspace key={member.venueId} client={client} member={member} user={user} logout={logout}
      environment={environment} members={members ?? []} onVenueChange={setVenue} />
  }
  return <><header className="topbar"><strong>TeamBrief</strong><button className="secondary-button" onClick={logout}>Sign out</button></header>
    {error ? <main><p role="alert" className="error-banner">{error}</p><button onClick={() => { setMembers(null); setError(''); setAttempt(n => n + 1) }}>Retry</button></main>
      : !members ? <main role="status">Loading pub membership…</main>
      : <main><h1>Access not granted</h1><p>Your account has no active pub membership. Ask your pub administrator to assign access.</p></main>}
  </>
}

const titles = {
  home: 'Home', create: 'Report Incident', mine: 'My Incidents', active: 'Active Decisions',
  updates: 'Updates', review: 'Management', history: 'Decision history', account: 'Account',
}
type Page = keyof typeof titles
const mobileTabs = [
  { page: 'home', label: 'Home', icon: '⌂' },
  { page: 'create', label: 'Report', icon: '+' },
  { page: 'active', label: 'Active bans', icon: '⊘' },
] as const
const morePages = ['mine', 'updates', 'account'] as const
const managerPages = ['review', 'history'] as const

function MobileNavigation({ page, navigate, manager }: { page: Page; navigate: (page: Page) => void; manager: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const links = manager ? [...morePages, ...managerPages] : morePages
  useEffect(() => {
    const mobile = window.matchMedia?.('(max-width: 700px)')
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) dialog.current?.close()
    }
    mobile?.addEventListener('change', closeOnDesktop)
    return () => mobile?.removeEventListener('change', closeOnDesktop)
  }, [])

  return <>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {mobileTabs.map(tab => <button key={tab.page} type="button" className="mobile-tab"
        aria-current={page === tab.page ? 'page' : undefined} onClick={() => navigate(tab.page)}>
        <span aria-hidden="true">{tab.icon}</span>{tab.label}
      </button>)}
      <button ref={opener} type="button" className="mobile-tab" aria-haspopup="dialog" aria-expanded={expanded}
        aria-controls="mobile-more" data-current={links.some(link => link === page)}
        onClick={() => { opener.current?.focus(); dialog.current?.showModal(); setExpanded(true) }}>
        <span aria-hidden="true">⋯</span>More
      </button>
    </nav>
    <dialog id="mobile-more" ref={dialog} className="mobile-more" aria-labelledby="mobile-more-title"
      onClose={() => setExpanded(false)}>
      <div className="mobile-more-heading">
        <h2 id="mobile-more-title">More</h2>
        <form method="dialog"><button className="secondary-button">Close</button></form>
      </div>
      <ul>{links.map(link => <li key={link}><button type="button" aria-current={link === page ? 'page' : undefined}
        onClick={() => { dialog.current?.close(); navigate(link) }}>{titles[link]}</button></li>)}</ul>
    </dialog>
  </>
}

function Workspace({ client, member, user, logout, environment, members, onVenueChange }: {
  client: SupabaseClient; member: Membership; user: User; logout: () => Promise<void>; environment: string
  members: Membership[]; onVenueChange: (venueId: string) => void
}) {
  const [data, setData] = useState<Data>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState<Page>('home')
  const heading = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [homeQuery, setHomeQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [totals, setTotals] = useState<TeamTotals | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const scope = useMemo(requestScope, [])
  const lifetime = useMemo(requestScope, [])
  const manager = member.role === 'manager'
  const [allowed, setAllowed] = useState(true)
  async function refresh() {
    const ticket = scope.invalidate()
    setRefreshVersion(version => version + 1)
    setNow(Date.now())
    setError(''); setNotice('')
    try {
      const current = (await memberships(client, member.userId)).find(m => m.venueId === member.venueId && m.role === member.role)
      if (!current) { if (scope.current(ticket)) { setAllowed(false); setData(emptyData()) }; throw new Error('Your pub membership changed. Sign out and sign in again to refresh access.') }
      const [next, counts] = await Promise.all([loadData(client, current), loadTeamTotals(client, current.venueId)])
      if (scope.current(ticket)) { setData(next); setTotals(counts); setAllowed(true) }
    } catch (e) { if (scope.current(ticket)) { setData(emptyData()); setTotals(null); setError(message(e)) }; throw e }
    finally { if (scope.current(ticket)) setLoading(false) }
  }
  useEffect(() => {
    void refresh().catch(() => {})
    const timer = window.setInterval(() => { void refresh().catch(() => {}) }, 15000)
    const focus = () => { void refresh().catch(() => {}) }
    window.addEventListener('focus', focus)
    return () => { scope.invalidate(); lifetime.invalidate(); window.clearInterval(timer); window.removeEventListener('focus', focus) }
  // A workspace is keyed by user and pub; cleanup invalidates all pending results.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, member.venueId, member.userId, scope])
  async function mutate(write: () => Promise<unknown>, next: Page, incidentSubmission = false): Promise<string | null> {
    const ticket = lifetime.ticket(); setNotice('')
    try {
      await runMutation(write, async () => { if (!lifetime.current(ticket)) throw new Error('Account changed.'); await refresh() })
      // Refresh starts a new generation; unmounted workspaces cannot publish data.
      if (lifetime.current(ticket)) { setNotice('Saved successfully.'); setSelected(null); setPage(next) }
      return null
    } catch (e) {
      const failure = message(e)
      if (lifetime.current(ticket) && failure.startsWith('Saved, but')) {
        if (incidentSubmission) {
          setError('Incident saved. Use Refresh to reload the list.')
          setPage(next)
          setSelected(null)
          return null
        }
        setError(failure)
      }
      return failure
    }
  }
  const incidentsById = useMemo(() => new Map(data.incidents.map(report => [report.id, report])), [data.incidents])
  const mine = data.incidents.filter(r => r.reportedBy === member.userId)
  const pending = data.incidents.filter(r => !r.decision)
  const incident = selected ? incidentsById.get(selected) : undefined
  const historyDecision = page === 'history' ? data.decisions.find(d => d.id === selected) : undefined
  const directoryPage = page === 'home' || page === 'active'
  const banProps = { client, venueId: member.venueId, now, refreshVersion }
  function navigate(p: Page) {
    setPage(p); setSelected(null); setNotice('')
    window.scrollTo(0, 0)
    window.requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
  }
  function viewAll(query: string) { setActiveQuery(query); navigate('active') }
  function openBan(id: string) { if (page === 'home') viewAll(homeQuery.trim()); setSelected(id) }
  function decisionView(d: ServerDecision) {
    return <section className="panel detail"><h2>{d.kind === 'no-ban' ? 'No ongoing ban required' : d.liftedAt ? 'Service ban lifted' : 'Active service ban'}</h2><p>{d.explanation}</p><p>Decided by account: {d.decidedBy} · {formatDate(d.decidedAt)}</p>{d.kind === 'ban' && <><p className="service-instruction">{d.instruction}</p><p>{severityLabels[d.severity!]} severity · Review due: {formatDate(d.reviewAt!)}</p>{!d.liftedAt && Date.parse(d.reviewAt!) <= now && <p className="review-warning">Review overdue. The ban remains active until a manager lifts it.</p>}<p className="info-note">Low severity does not permit service. Follow the service instructions.</p>{d.liftedAt ? <p>Lifted by account {d.liftedBy} · {formatDate(d.liftedAt)} · {d.liftReason}</p> : manager && <LiftForm key={d.id} showServiceNote onSave={(reason, note) => mutate(() => liftDecision(client, member.venueId, d.id, reason, note), page)} />}</>}<h3>Decision history</h3>{data.history.filter(h => h.decisionId === d.id).map(h => <p key={h.id}>{h.event} · {formatDate(h.at)} · Account {h.actorId} · {h.reason}</p>)}{!data.history.some(h => h.decisionId === d.id) && <p>History is available to the reporting employee and pub managers.</p>}</section>
  }
  function incidentPhoto(report: Incident, compact = false) {
    return <IncidentPhoto key={report.id} client={client} photo={report.photo} label={report.label} compact={compact} />
  }
  function list(items: Incident[], showStatus: boolean) {
    return items.length ? <ul className="report-list">{items.map(report => <li key={report.id} className="report-with-photo">
      {incidentPhoto(report, true)}
      <button className="report-row status-report-row" onClick={() => setSelected(report.id)}>
        <span className="status-row-heading"><strong>{report.label}</strong>{showStatus && <DecisionStatus decision={report.decision} />}</span>
        <StatusDate label="Incident date" value={report.occurredAt} />
      </button>
    </li>)}</ul> : <p className="empty">No incidents to show.</p>
  }
  const navPages = (Object.keys(titles) as Page[]).filter(p => manager || (p !== 'review' && p !== 'history'))
  return <div className="app-shell connected-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('home') }}>TeamBrief</a>
      <p>{member.venueName}</p>
      <nav aria-label="Main navigation">{navPages.map(p => <button key={p} className={page === p ? 'nav-item active' : 'nav-item'}
        aria-current={page === p ? 'page' : undefined} onClick={() => navigate(p)}>{titles[p]}</button>)}</nav>
      <div className="profile">{member.name} · {manager ? 'Manager' : 'Staff'}</div>
    </aside>
    <header className="mobile-heading">
      <div><strong>TeamBrief</strong><span>{member.venueName}</span></div>
      <button type="button" className="secondary-button" aria-current={page === 'account' ? 'page' : undefined}
        onClick={() => navigate('account')}>Account</button>
    </header>
    <div className="workspace">
      {members.length > 1 && <label className="pub-picker">Switch pub <select value={member.venueId}
        onChange={e => onVenueChange(e.target.value)}>{members.map(m => <option key={m.venueId} value={m.venueId}>{m.venueName}</option>)}</select></label>}
      <main className="connected-workspace">
    <header className="connected-heading">
      <h1 ref={heading} tabIndex={-1} id={page === 'active' ? 'active-decisions' : undefined}>{titles[page]}</h1>
      {page !== 'account' && <div className="connected-actions">
        <button className="secondary-button" onClick={() => { void refresh().catch(() => {}) }}>Refresh</button>
        {page === 'home' && <button className="primary" onClick={() => navigate('create')}>Report incident</button>}
      </div>}
    </header>
    {page === 'account' && <section className="panel detail account-details" aria-label="Account details">
      <dl>
        <div><dt>Name</dt><dd>{member.name}</dd></div>
        <div><dt>Email</dt><dd>{user.email ?? 'Unavailable'}</dd></div>
        <div><dt>Selected pub</dt><dd>{member.venueName}</dd></div>
        <div><dt>Role</dt><dd>{manager ? 'Manager' : 'Staff'}</dd></div>
      </dl>
      <p className="account-environment">{environment}</p>
      <button className="secondary-button" onClick={logout}>Sign out</button>
    </section>}
    {notice && <p className="success-banner" role="status">{notice}</p>}
    {page === 'home' && <div className="summary-strip" role="group" aria-label="Pub totals">
      <button onClick={() => viewAll('')}>Active Decisions <strong>{totals?.active_bans ?? '—'}</strong></button>
      <button onClick={() => navigate('mine')}>My Incidents <strong>{totals?.my_incidents ?? '—'}</strong></button>
      {manager && <button onClick={() => navigate('review')}>Awaiting review <strong>{totals?.awaiting_review ?? '—'}</strong></button>}
    </div>}
    {directoryPage && allowed && (page === 'active' && selected ? <>
      <button className="text-button" onClick={() => setSelected(null)}>← Back to active decisions</button>
      <ActiveBanDetail key={selected} {...banProps} id={selected} onLift={manager ? (id, reason, note) =>
        mutate(() => liftDecision(client, member.venueId, id, reason, note), 'active') : undefined} />
    </> : <ActiveBanDirectory key={page} {...banProps} home={page === 'home'} query={page === 'home' ? homeQuery : activeQuery}
      onQuery={page === 'home' ? setHomeQuery : setActiveQuery} onOpen={openBan} onAll={viewAll} />)}
    {(directoryPage || page === 'updates') && allowed && <Updates key={`updates-${page}`} client={client}
      venueId={member.venueId} refreshVersion={refreshVersion} recent={directoryPage}
      onAll={() => navigate('updates')} onActive={() => { viewAll(''); window.scrollTo(0, 0) }} />}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {page !== 'account' && (loading ? (!directoryPage && page !== 'updates' && <p role="status">Loading team records…</p>) : (error && page !== 'create') || !allowed
      ? (!directoryPage && page !== 'updates' && <p>Records are unavailable. Refresh to try again.</p>) : <>
    {page === 'create' && <ConnectedReportForm client={client} member={member} save={write => mutate(write, 'mine', true)} />}
    {(page === 'mine' || page === 'review') && (incident ? <><button onClick={() => setSelected(null)}>← Back</button><FullIncident incident={incident}>{incidentPhoto(incident)}</FullIncident>{incident.decision ? decisionView(incident.decision) : page === 'review' && manager ? <DecisionForm actor={member.name} key={incident.id} onSave={draft => mutate(() => createDecision(client, member.venueId, incident.id, draft), 'review')} /> : <p>Awaiting review.</p>}</> : list(page === 'mine' ? mine : pending, page === 'mine'))}
    {page === 'history' && manager && (historyDecision ? <>
      <button onClick={() => setSelected(null)}>← Back</button>
      {(() => {
        const report = incidentsById.get(historyDecision.reportId)
        return report && <FullIncident incident={report}>{incidentPhoto(report)}</FullIncident>
      })()}
      {decisionView(historyDecision)}
    </> : data.decisions.length ? <ul className="report-list">{data.decisions.map(d => {
      const report = incidentsById.get(d.reportId)
      return <li key={d.id} className="report-with-photo">
        {report && incidentPhoto(report, true)}
        <button className="report-row status-report-row" onClick={() => setSelected(d.id)}>
          <span className="status-row-heading"><strong>{report?.label ?? 'Incident'}</strong><DecisionStatus decision={d} /></span>
          <span className="status-explanation">{d.explanation}</span>
          <span className="status-row-dates">
            <StatusDate label="Decision date" value={d.decidedAt} />
            {d.liftedAt && <StatusDate label="Lifted date" value={d.liftedAt} />}
          </span>
        </button>
      </li>
    })}</ul> : <p className="empty">No decisions yet.</p>)}
  </>)}
      </main>
    </div>
    <MobileNavigation page={page} navigate={navigate} manager={manager} />
  </div>
}
function DecisionStatus({ decision }: { decision: ServerDecision | null }) {
  const status = decisionStatus(decision)
  return <span className={`badge decision-status ${status}`}>{decisionStatusLabels[status]}</span>
}
function StatusDate({ label, value }: { label: string; value: string }) {
  return <span className="record-date">{label} <time dateTime={value}>{formatDate(value)}</time></span>
}

function ConnectedReportForm({ client, member, save }: {
  client: SupabaseClient
  member: Membership
  save: (write: () => Promise<unknown>) => Promise<string | null>
}) {
  const attempt = useRef<PhotoSubmission | null>(null)
  const upload = useRef<AbortController | null>(null)
  const venueId = member.venueId
  useEffect(() => () => {
    upload.current?.abort()
    const pending = attempt.current
    if (pending?.photo) {
      // If finalization won the race, the server protects the linked photo.
      void discardIncidentPhoto(client, venueId, pending.reportId, pending.photo.uploadId).catch(() => {})
    }
  }, [client, venueId])

  function discard(file: File) {
    const current = attempt.current
    if (!current?.photo || current.photo.file !== file) return
    void discardIncidentPhoto(client, venueId, current.reportId, current.photo.uploadId).catch(() => {})
    attempt.current = { reportId: current.reportId }
  }

  return <ReportForm actor={member.name} onDiscardPhoto={discard} onSave={(draft, file, progress) => {
    const previous = attempt.current
    const current: PhotoSubmission = {
      reportId: previous?.reportId ?? crypto.randomUUID(),
      photo: file ? (previous?.photo?.file === file ? previous.photo : { file, uploadId: crypto.randomUUID() }) : undefined,
    }
    attempt.current = current
    upload.current = new AbortController()
    const signal = upload.current.signal
    return save(() => submitIncident(client, venueId, draft, current, stage => {
      if (!signal.aborted) progress(stage)
    }, signal))
  }} />
}

function FullIncident({ incident: r, children }: { incident: Incident; children: React.ReactNode }) {
  return <section className="panel detail"><h2>{r.label}</h2>{children}<dl><div><dt>Reported by account</dt><dd>{r.reportedBy}</dd></div><div><dt>Incident time</dt><dd>{formatDate(r.occurredAt)}</dd></div><div><dt>Incident type</dt><dd>{incidentLabels[r.incidentType]}</dd></div><div><dt>Suggested severity</dt><dd>{severityLabels[r.severity]}</dd></div><div className="wide"><dt>Identifying description</dt><dd>{r.appearance}</dd></div><div className="wide"><dt>Incident description</dt><dd>{r.description}</dd></div></dl></section>
}
