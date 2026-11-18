import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { incidentTypes, incidentLabels, statusLabels, roleLabels, formatDate, localDateTime, newestFirst, severityLabels, validateDraft } from './reports'
import type { FormErrors, Report, ReportDraft, Severity, IncidentType } from './reports'
import { activeBans, addDecision, currentStorageKey, liftBan, loadStore, pendingReports, reviewDue, validateDecision, writeStore } from './decisions'
import type { Decision, DecisionDraft, Profile, Store } from './decisions'
import { useObjectUrl } from './use-object-url'
import { photoAccept, validateIncidentPhoto } from './incident-photo-files'
import './App.css'

type Page = 'home' | 'create' | 'reports' | 'active' | 'admin'
const pages: { id: Page; title: string; icon: string }[] = [
  { id: 'home', title: 'Home', icon: '⌂' },
  { id: 'create', title: 'Report Incident', icon: '+' },
  { id: 'reports', title: 'My Reports', icon: '☷' },
  { id: 'active', title: 'Active Decisions', icon: '◇' },
  { id: 'admin', title: 'Management', icon: '☑' },
]
const decisionTitle = (d: Decision) => d.kind === 'no-ban' ? 'No ongoing ban required' : d.lifted ? 'Service ban lifted' : 'Active service ban'
const emptyStore: Store = { version: 3, reports: [], decisions: [] }
const readError = 'Unable to read saved records or access browser storage. Your records have not been deleted. Check your browser settings and reload the page.'

function App() {
  const [initial] = useState(() => {
    try { return { store: loadStore(localStorage), error: '' } }
    catch { return { store: emptyStore, error: readError } }
  })
  const [store, setStore] = useState(initial.store)
  const [storageError, setStorageError] = useState(initial.error)
  const [profile, setProfile] = useState<Profile>('employee')
  const isManager = profile === 'manager'
  const [page, setPage] = useState<Page>('home')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState(false)
  const [now, setNow] = useState(Date.now())
  const heading = useRef<HTMLHeadingElement>(null)
  const sorted = newestFirst(store.reports)
  const pending = pendingReports(store)
  const bans = activeBans(store)
  const selected = store.reports.find(report => report.id === selectedId)
  const selectedDecision = store.decisions.find(d => d.reportId === selectedId)
  const visiblePages = pages.filter(p => p.id !== 'admin' || isManager)

  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0) }, [page, selectedId, profile])
  useEffect(() => {
    const refresh = () => {
      try { setStore(loadStore(localStorage)); setStorageError('') }
      catch { setStorageError(readError) }
      setNow(Date.now())
    }
    const sync = (event: StorageEvent) => { if (event.key === currentStorageKey || event.key === null) refresh() }
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    window.addEventListener('storage', sync)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('focus', refresh) }
  }, [])
  function navigate(next: Page) {
    if (next === 'admin' && !isManager) return
    setPage(next); setSelectedId(null); setNotice('')
  }
  function switchProfile(value: Profile) {
    setProfile(value); setPage('home'); setSelectedId(null); setNotice(''); setHistory(false)
  }
  function mutate(update: (current: Store) => Store, message: string): string | null {
    try {
      const current = loadStore(localStorage)
      setStore(current)
      const updated = update(current)
      writeStore(localStorage, updated)
      setStore(updated); setStorageError(''); setNotice(message); setNow(Date.now())
      return null
    } catch (error) { return error instanceof Error ? `Unable to save: ${error.message}` : 'Unable to save. Check your browser storage settings.' }
  }
  function save(draft: ReportDraft): string | null {
    if (Object.keys(validateDraft(draft)).length) return 'Please check the report fields.'
    const report: Report = {
      ...draft, incidentType: draft.incidentType as IncidentType, label: draft.label.trim(),
      occurredAt: new Date(draft.occurredAt).toISOString(), id: crypto.randomUUID(), createdAt: new Date().toISOString(), employee: 'Müslüm', status: 'pending_review',
    }
    const error = mutate(current => ({ ...current, reports: newestFirst([report, ...current.reports]) }), 'Your report has been saved and is awaiting review.')
    if (!error) { setPage('reports'); setSelectedId(null) }
    return error
  }
  function review(draft: DecisionDraft): string | null {
    if (!selectedId) return 'Please select a report first.'
    const error = mutate(current => addDecision(current, profile, selectedId, draft), 'The decision has been saved. The report is no longer awaiting review.')
    if (!error) { setSelectedId(null); setHistory(false) }
    return error
  }
  function removeBan(id: string, reason: string): string | null {
    const error = mutate(current => liftBan(current, profile, id, reason), 'The service ban has been lifted. The decision and reason remain in the history.')
    if (!error && page === 'active') setSelectedId(null)
    return error
  }
  function openReport(id: string, target: Page) { setSelectedId(id); setPage(target); setNotice('') }
  function reportList(items: Report[], target: Page = 'reports') {
    if (!items.length) return <Empty title={target === 'admin' ? (history ? 'No decisions yet' : 'No reports awaiting review') : 'No reports yet'} text={target === 'admin' ? 'Reports awaiting review and past decisions will appear here.' : 'Your incident reports will appear here once you submit one.'} />
    return <ul className="report-list">{items.map(report => {
      const decision = store.decisions.find(d => d.reportId === report.id)
      return <li key={report.id}><button className="report-row" onClick={() => openReport(report.id, target)}><div className="report-info"><strong>{report.label}</strong><span>{incidentLabels[report.incidentType]} · {formatDate(report.occurredAt)}</span><span className="pending">{decision ? decisionTitle(decision) : statusLabels.pending_review}</span></div><div className="row-end"><SeverityBadge severity={report.severity} /><span aria-hidden="true">↗</span></div></button></li>
    })}</ul>
  }
  function detail(back: string) {
    if (!selected) return null
    return <><section className="panel detail"><button className="text-button" onClick={() => setSelectedId(null)}>← {back}</button><ReportDetails report={selected} /><p className="info-note">The original report is shown above. A report does not create a service ban; the manager’s decision is recorded separately.</p></section>
      {selectedDecision ? <DecisionDetails decision={selectedDecision} now={now} isManager={isManager} onLift={removeBan} /> : page === 'admin' && isManager ? <DecisionForm key={selected.id} onSave={review} /> : <p className="info-note">Awaiting review. A manager has not made a decision yet.</p>}</>
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="./" onClick={e => { e.preventDefault(); navigate('home') }}><span className="brand-mark" aria-hidden="true">tb<span>•</span></span>TeamBrief</a>
      <p className="sidebar-caption">KEEPING THE TEAM INFORMED</p>
      <nav aria-label="Main navigation" style={{ '--nav-count': visiblePages.length } as React.CSSProperties}>{visiblePages.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}</nav>
      <div className="profile"><span className="avatar" aria-hidden="true">{isManager ? 'A' : 'M'}</span><div><strong>{isManager ? 'Alex' : 'Müslüm'}</strong><small>{isManager ? 'Demo manager' : 'Demo employee'}</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><strong>Team workspace</strong><p className="demo-explanation">Demo profiles only. This is not real authentication or access control.</p></div><div className="profile-picker"><label htmlFor="demo-profile">Demo profile</label><select id="demo-profile" value={profile} onChange={e => switchProfile(e.target.value as Profile)}><option value="employee">Müslüm — {roleLabels.employee}</option><option value="manager">Alex — {roleLabels.manager}</option></select></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">TEAMBRIEF</p><h1 tabIndex={-1} ref={heading}>{selected ? 'Report and decision details' : pages.find(p => p.id === page)?.title}</h1><p>{page === 'home' ? `Hello ${isManager ? 'Alex' : 'Müslüm'}, here’s the latest for your team.` : page === 'create' ? 'Incident reports are saved under the demo employee, Müslüm.' : page === 'active' ? 'Current manager decisions to follow during service.' : page === 'admin' ? 'Review reports, record decisions and view decision history.' : 'Reports submitted by Müslüm and their review outcomes.'}</p></div>{page === 'home' && <button className="primary" onClick={() => navigate('create')}>+ Report incident</button>}</div>
        <p className="storage-note">ⓘ Reports and decisions are stored only in this browser. They do not sync across devices and will be lost if browser data is cleared.</p>
        {storageError && <p className="error-banner" role="alert">{storageError}</p>}
        {notice && <p className="success-banner" role="status">{notice}</p>}
        {page === 'home' && <><div className="stats"><div><span>Total reports</span><strong>{store.reports.length}</strong><small>Submitted by Müslüm</small></div><div><span>Awaiting review</span><strong>{pending.length}</strong><small>No decisions yet</small></div><div><span>Active bans</span><strong>{bans.length}</strong><small>Created by a manager</small></div></div><section className="panel"><div className="section-heading"><h2>Recent reports</h2><button className="text-button" onClick={() => navigate('reports')}>View all →</button></div>{reportList(sorted.slice(0, 5))}</section></>}
        {page === 'create' && <ReportForm onSave={save} />}
        {page === 'reports' && (selected ? detail('Back to my reports') : <section className="panel"><div className="section-heading"><h2>My Reports <span className="count">{store.reports.length}</span></h2><span className="muted">Newest first</span></div>{reportList(sorted)}</section>)}
        {page === 'admin' && isManager && (selected ? detail('Back to management') : <section className="panel"><div className="section-heading"><div className="tabs" aria-label="Review lists"><button className={!history ? 'tab active' : 'tab'} aria-pressed={!history} onClick={() => setHistory(false)}>Awaiting review ({pending.length})</button><button className={history ? 'tab active' : 'tab'} aria-pressed={history} onClick={() => setHistory(true)}>Decision history ({store.decisions.length})</button></div></div>{reportList(history ? [...store.decisions].sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)).map(d => store.reports.find(r => r.id === d.reportId)!) : newestFirst(pending), 'admin')}</section>)}
        {page === 'active' && <><p className="info-note">A low severity rating does not permit service while a ban is active. Follow the service instructions. Reaching the review date does not automatically lift the ban.</p>{selected && selectedDecision?.kind === 'ban' && !selectedDecision.lifted ? <><section className="panel detail"><button className="text-button" onClick={() => setSelectedId(null)}>← Back to active decisions</button><ReportDetails report={selected} /></section><DecisionDetails decision={selectedDecision} now={now} isManager={isManager} onLift={removeBan} /></> : <section className="panel"><div className="section-heading"><h2>Active service bans <span className="count">{bans.length}</span></h2></div>{!bans.length ? <Empty title="No active service bans" text="Service bans created by a manager will appear here until they are lifted." /> : <ul className="report-list">{[...bans].sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)).map(d => <li key={d.id}><button className="report-row" onClick={() => openReport(d.reportId, 'active')}><div className="report-info"><strong>{store.reports.find(r => r.id === d.reportId)?.label}</strong><span className="instruction-preview">Service instructions: {d.instruction}</span><span>Review due: {formatDate(d.reviewAt)}</span>{reviewDue(d, now) && <span className="review-warning">Review overdue</span>}</div><div className="row-end"><SeverityBadge severity={d.severity} /><span aria-hidden="true">↗</span></div></button></li>)}</ul>}</section>}</>}
      </main><footer>Shared knowledge. Strong team. Safer service.</footer>
    </div>
  </div>
}
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><span aria-hidden="true">☷</span><h3>{title}</h3><p>{text}</p></div> }
function SeverityBadge({ severity }: { severity: Severity }) { return <span className={`badge ${severity}`}>{severityLabels[severity]} severity</span> }
function ReportDetails({ report }: { report: Report }) {
  return <><div className="detail-heading"><h2>{report.label}</h2><SeverityBadge severity={report.severity} /></div><p className="muted">Suggested severity in the original report</p><dl><div><dt>Reported by</dt><dd>{report.employee}</dd></div><div><dt>Incident date and time</dt><dd>{formatDate(report.occurredAt)}</dd></div><div><dt>Incident type</dt><dd>{incidentLabels[report.incidentType]}</dd></div><div><dt>Submitted on</dt><dd>{formatDate(report.createdAt)}</dd></div><div className="wide"><dt>Identifying description</dt><dd>{report.appearance}</dd></div><div className="wide"><dt>Incident description</dt><dd>{report.description}</dd></div></dl></>
}
function DecisionDetails({ decision: d, now, isManager, onLift }: { decision: Decision; now: number; isManager: boolean; onLift: (id: string, reason: string) => string | null | Promise<string | null> }) {
  return <section className="panel detail decision-detail"><div className="detail-heading"><h2>Review outcome</h2><span className="pending">{decisionTitle(d)}</span></div><dl><div><dt>Decided by</dt><dd>{d.manager}</dd></div><div><dt>Decision date and time</dt><dd>{formatDate(d.decidedAt)}</dd></div><div className="wide"><dt>Reason for the decision</dt><dd>{d.explanation}</dd></div>{d.kind === 'ban' && <><div><dt>Final severity</dt><dd><SeverityBadge severity={d.severity} /></dd></div><div><dt>Review date and time</dt><dd>{formatDate(d.reviewAt)}</dd></div><div className="wide"><dt>Service instructions</dt><dd className="service-instruction">{d.instruction}</dd></div>{d.lifted && <><div><dt>Ban lifted by</dt><dd>{d.lifted.manager}</dd></div><div><dt>Date and time lifted</dt><dd>{formatDate(d.lifted.at)}</dd></div><div className="wide"><dt>Reason for lifting the ban</dt><dd>{d.lifted.reason}</dd></div></>}</>}</dl>{reviewDue(d, now) && <p className="review-warning" role="status">Review overdue. The ban remains active until a manager lifts it.</p>}{d.kind === 'ban' && !d.lifted && <><p className="info-note">A low severity rating does not permit service. Follow the service instructions above.</p>{isManager && <LiftForm key={d.id} onSave={reason => onLift(d.id, reason)} />}</>}</section>
}
export function DecisionForm({ onSave, actor = 'Alex' }: { actor?: string; onSave: (draft: DecisionDraft) => string | null | Promise<string | null> }) {
  const [draft, setDraft] = useState<DecisionDraft>({ kind: 'ban', explanation: '', severity: 'medium', instruction: '', reviewAt: '' })
  const [errors, setErrors] = useState<ReturnType<typeof validateDecision>>({})
  const [failure, setFailure] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const saving = useRef(false)
  const [pendingSave, setPendingSave] = useState(false)
  const [minDate, setMinDate] = useState(localDateTime(new Date(Date.now() + 60000)))
  useEffect(() => { const id = window.setInterval(() => setMinDate(localDateTime(new Date(Date.now() + 60000))), 15000); return () => window.clearInterval(id) }, [])
  function update(field: keyof DecisionDraft, value: string) { setDraft(prev => ({ ...prev, [field]: value })); setErrors({}); setFailure('') }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving.current) return
    const result = validateDecision(draft)
    setErrors(result)
    const first = Object.keys(result)[0]
    if (first) { form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return }
    saving.current = true; setPendingSave(true)
    try { const error = await onSave(draft); if (error) setFailure(error) }
    catch { setFailure('Unable to save the decision. Please try again.') }
    finally { saving.current = false; setPendingSave(false) }
  }
  const props = (field: keyof DecisionDraft) => ({ id: `decision-${field}`, name: field, required: true, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': `decision-${field}-help${errors[field] ? ` decision-${field}-error` : ''}` })
  const error = (field: keyof DecisionDraft) => errors[field] && <span className="field-error" id={`decision-${field}-error`}>{errors[field]}</span>
  return <form className="panel report-form decision-detail" onSubmit={submit} ref={form} noValidate><div className="section-heading"><h2>Manager decision</h2><span className="muted">Decided by: {actor}</span></div><div className="form-grid">
    <div className="field wide"><label htmlFor="decision-kind">Decision</label><p id="decision-kind-help">The decision is saved separately from the original report.</p><select {...props('kind')} value={draft.kind} onChange={e => update('kind', e.target.value)}><option value="ban">Create service ban</option><option value="no-ban">No ongoing ban required</option></select>{error('kind')}</div>
    <div className="field wide"><label htmlFor="decision-explanation">Reason for the decision</label><p id="decision-explanation-help">A reason is required for either decision. For example: “A service ban is needed because there is a risk of further incidents.”</p><textarea {...props('explanation')} rows={3} maxLength={10000} value={draft.explanation} onChange={e => update('explanation', e.target.value)} />{error('explanation')}</div>
    {draft.kind === 'ban' && <><div className="field"><label htmlFor="decision-severity">Final severity</label><p id="decision-severity-help">The manager’s assessment. Low severity does not permit service.</p><select {...props('severity')} value={draft.severity} onChange={e => update('severity', e.target.value)}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{error('severity')}</div><div className="field"><label htmlFor="decision-reviewAt">Review date and time</label><p id="decision-reviewAt-help">Choose a future date and time in your local time zone. The ban will not be lifted automatically.</p><input {...props('reviewAt')} type="datetime-local" min={minDate} value={draft.reviewAt} onFocus={() => setMinDate(localDateTime(new Date(Date.now() + 60000)))} onChange={e => update('reviewAt', e.target.value)} />{error('reviewAt')}</div><div className="field wide"><label htmlFor="decision-instruction">Service instructions</label><p id="decision-instruction-help">What should staff do? For example: “Do not serve this person. Notify the duty manager.”</p><textarea {...props('instruction')} rows={3} maxLength={10000} value={draft.instruction} onChange={e => update('instruction', e.target.value)} />{error('instruction')}</div></>}
    </div>{Object.keys(errors).length > 0 && <p className="field-error" role="alert">Please check the highlighted decision fields.</p>}{failure && <p className="error-banner" role="alert">{failure}</p>}<div className="form-actions"><button type="submit" className="primary" disabled={pendingSave}>{pendingSave ? 'Saving…' : 'Save decision'}</button></div></form>
}
export function LiftForm({ onSave, showServiceNote = false }: { showServiceNote?: boolean; onSave: (reason: string, serviceNote: string) => string | null | Promise<string | null> }) {
  const [reason, setReason] = useState('')
  const [serviceNote, setServiceNote] = useState('')
  const noteInput = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const saving = useRef(false)
  const [pendingSave, setPendingSave] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving.current) return
    if (!reason.trim()) { setError('Please give a reason for lifting the ban.'); input.current?.focus(); return }
    if (showServiceNote && !serviceNote.trim()) { setError('Please enter a service note for the team.'); noteInput.current?.focus(); return }
    saving.current = true; setPendingSave(true)
    try { const failure = await onSave(reason.trim(), serviceNote.trim()); if (failure) setError(failure) }
    catch { setError('Unable to lift the ban. Please try again.') }
    finally { saving.current = false; setPendingSave(false) }
  }
  return <form className="lift-form" onSubmit={submit} noValidate><h3>Lift ban</h3><div className="field"><label htmlFor="lift-reason">Reason for lifting the ban</label><p id="lift-help">Explain why the ban is no longer needed. This reason, the manager’s name and the time will remain in the decision history.</p><textarea id="lift-reason" ref={input} required rows={3} maxLength={10000} value={reason} aria-invalid={Boolean(error)} aria-describedby={`lift-help${error ? ' lift-error' : ''}`} onChange={e => { setReason(e.target.value); setError('') }} /></div>{showServiceNote && <div className="field">
    <label htmlFor="lift-service-note">Service note for the team</label>
    <p id="lift-service-help">Active pub members will see this note in Recent Updates. Include only what the team needs for service.</p>
    <textarea id="lift-service-note" ref={noteInput} rows={3} maxLength={10000} required value={serviceNote} aria-describedby="lift-service-help" onChange={e => { setServiceNote(e.target.value); setError('') }} />
  </div>}{error && <p className="field-error" id="lift-error" role="alert">{error}</p>}<div className="form-actions"><button className="primary" type="submit" disabled={pendingSave}>{pendingSave ? 'Saving…' : 'Lift ban with reason'}</button></div></form>
}
export function ReportForm({ onSave, actor = 'Müslüm', onDiscardPhoto }: {
  actor?: string
  onSave: (draft: ReportDraft, photo: File | null, progress: (stage: string) => void) => string | null | Promise<string | null>
  onDiscardPhoto?: (file: File) => void
}) {
  const [draft, setDraft] = useState<ReportDraft>({ label: '', occurredAt: '', incidentType: '', severity: 'medium', appearance: '', description: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveError, setSaveError] = useState('')
  const [maxDate, setMaxDate] = useState(localDateTime())
  const form = useRef<HTMLFormElement>(null)
  const saving = useRef(false)
  const [pendingSave, setPendingSave] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [decodedPhoto, setDecodedPhoto] = useState<File | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [checkingPhoto, setCheckingPhoto] = useState(false)
  const [progress, setProgress] = useState('')
  const selection = useRef(0)
  const preview = useObjectUrl(photo)
  const photoPending = checkingPhoto || (photo !== null && decodedPhoto !== photo && !photoError)
  function removePhoto() {
    selection.current += 1
    if (photo) onDiscardPhoto?.(photo)
    setPhoto(null)
    setDecodedPhoto(null)
    setPhotoError('')
    setCheckingPhoto(false)
    setSaveError('')
  }
  async function choosePhoto(file: File) {
    const ticket = ++selection.current
    setCheckingPhoto(true)
    setPhotoError('')
    setSaveError('')
    try {
      await validateIncidentPhoto(file)
      if (ticket !== selection.current) return
      if (photo) onDiscardPhoto?.(photo)
      setDecodedPhoto(null)
      setPhoto(file)
    } catch (error) {
      if (ticket === selection.current) setPhotoError(error instanceof Error ? error.message : 'Unable to open the photo.')
    } finally {
      if (ticket === selection.current) setCheckingPhoto(false)
    }
  }
  useEffect(() => { const timer = window.setInterval(() => setMaxDate(localDateTime()), 15000); return () => window.clearInterval(timer) }, [])
  function update(field: keyof ReportDraft, value: string) {
    setDraft(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: undefined }))
    setSaveError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current || photoPending || photoError) return
    const nextErrors = validateDraft(draft)
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) { form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return }
    saving.current = true
    setPendingSave(true)
    setSaveError('')
    setProgress('')
    try { const failure = await onSave(draft, photo, setProgress); if (failure) setSaveError(failure) }
    catch { setSaveError('Unable to save the incident. Please try again.') }
    finally { saving.current = false; setPendingSave(false) }
  }
  function fieldProps(field: keyof ReportDraft) {
    return { id: field, name: field, required: true, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': `${field}-help${errors[field] ? ` ${field}-error` : ''}` }
  }
  const error = (field: keyof ReportDraft) => errors[field] && <span className="field-error" id={`${field}-error`}>{errors[field]}</span>
  return <form className="panel report-form" ref={form} onSubmit={submit} noValidate>
    <div className="section-heading"><h2>Incident details</h2><span className="muted">{onDiscardPhoto ? 'Incident details are required' : 'All fields are required'}</span></div>
    <fieldset className="form-grid incident-fields" disabled={pendingSave}>
      <div className="field"><label htmlFor="label">Short label for the person</label><p id="label-help">Use a short label to help you recognise the person. For example: “Guest in a blue jacket”.</p><input {...fieldProps('label')} value={draft.label} maxLength={100} placeholder="e.g. Guest in a blue jacket" onChange={e => update('label', e.target.value)} />{error('label')}</div>
      <div className="field"><label htmlFor="occurredAt">Incident date and time</label><p id="occurredAt-help">Enter when the incident happened in your local time zone. Future dates and times are not allowed.</p><input {...fieldProps('occurredAt')} type="datetime-local" max={maxDate} value={draft.occurredAt} onFocus={() => setMaxDate(localDateTime())} onChange={e => update('occurredAt', e.target.value)} />{error('occurredAt')}</div>
      <div className="field"><label htmlFor="incidentType">Incident type</label><p id="incidentType-help">Choose the type that best describes what you observed.</p><select {...fieldProps('incidentType')} value={draft.incidentType} onChange={e => update('incidentType', e.target.value)}><option value="">Select an incident type</option>{incidentTypes.map(type => <option key={type} value={type}>{incidentLabels[type]}</option>)}</select>{error('incidentType')}</div>
      <div className="field"><label htmlFor="severity">Suggested severity</label><p id="severity-help">Low: limited impact · Medium: intervention needed · High: serious safety risk.</p><select {...fieldProps('severity')} value={draft.severity} onChange={e => update('severity', e.target.value)}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{error('severity')}</div>
      <div className="field wide"><label htmlFor="appearance">Identifying description</label><p id="appearance-help">Describe observable features. For example: “Blue jacket, round glasses, short hair”.</p><textarea {...fieldProps('appearance')} rows={3} maxLength={2000} value={draft.appearance} placeholder="Clothing and distinguishing features…" onChange={e => update('appearance', e.target.value)} />{error('appearance')}</div>
      <div className="field wide"><label htmlFor="description">Incident description</label><p id="description-help">What happened, where did it happen and how did staff respond? For example: “They shouted at the bar. Staff asked them to calm down and they left the premises.”</p><textarea {...fieldProps('description')} rows={5} maxLength={10000} value={draft.description} placeholder="Describe what you observed…" onChange={e => update('description', e.target.value)} />{error('description')}</div>
    </fieldset>
    {onDiscardPhoto && <fieldset className="photo-fields" disabled={pendingSave}>
      <legend>Incident photo (optional)</legend>
      <p id="incident-photo-help">JPEG, PNG or WebP, up to 5 MB. Choose a file or use your phone’s camera.</p>
      <div className="photo-picker-actions">
        <label className="photo-picker-button">
          {photo ? 'Replace photo' : 'Choose photo'}
          <input type="file" accept={photoAccept} aria-describedby="incident-photo-help" onChange={e => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void choosePhoto(file)
          }} />
        </label>
        <label className="photo-picker-button camera-picker">
          Use camera
          <input type="file" accept={photoAccept} capture="environment" aria-describedby="incident-photo-help" onChange={e => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void choosePhoto(file)
          }} />
        </label>
        {(photo || photoError) && <button type="button" onClick={removePhoto}>Remove photo</button>}
      </div>
      {photoPending && <p role="status">Checking photo…</p>}
      {preview && !photoError && <img key={preview} className="draft-photo" src={preview} alt="Selected incident photo preview"
        onLoad={() => setDecodedPhoto(photo)}
        onError={() => setPhotoError('Unable to display this photo. Choose another file or remove it.')} />}
      {photoError && <p className="field-error" role="alert">{photoError}</p>}
    </fieldset>}
    <p className="info-note">Reported by: <strong>{actor}</strong> · New reports are saved as “Awaiting review”. A report does not automatically create a service ban.</p>
    {Object.keys(errors).some(key => errors[key as keyof ReportDraft]) && <p className="field-error" role="alert">Please check the highlighted fields.</p>}
    {saveError && <p className="error-banner" role="alert">{saveError}</p>}
    {pendingSave && progress && <p role="status">{progress}</p>}
    <div className="form-actions"><button className="primary" type="submit" disabled={pendingSave || photoPending || Boolean(photoError)}>{pendingSave ? 'Saving…' : 'Submit report →'}</button></div>
  </form>
}
export default App
