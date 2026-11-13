import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { incidentTypes, localDateTime, newestFirst, severityLabels, validateDraft } from './reports'
import type { FormErrors, Report, ReportDraft, Severity } from './reports'
import { activeBans, addDecision, currentStorageKey, liftBan, loadStore, pendingReports, reviewDue, validateDecision, writeStore } from './decisions'
import type { Decision, DecisionDraft, Profile, Store } from './decisions'
import './App.css'

type Page = 'home' | 'create' | 'reports' | 'active' | 'admin'
const pages: { id: Page; title: string; icon: string }[] = [
  { id: 'home', title: 'Ana Sayfa', icon: '⌂' },
  { id: 'create', title: 'Olay Bildir', icon: '+' },
  { id: 'reports', title: 'Bildirimlerim', icon: '☷' },
  { id: 'active', title: 'Aktif Kararlar', icon: '◇' },
  { id: 'admin', title: 'Yönetim', icon: '☑' },
]
const formatDate = (value: string) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value))
const decisionTitle = (d: Decision) => d.kind === 'no-ban' ? 'Devam eden yasak gerekmiyor' : d.lifted ? 'Servis yasağı kaldırıldı' : 'Aktif servis yasağı'
const emptyStore: Store = { version: 2, reports: [], decisions: [] }
const readError = 'Tarayıcıdaki kayıtlar okunamadı veya depolama kapalı. Mevcut kayıtlar silinmedi. Tarayıcı ayarlarını kontrol edip sayfayı yenileyin.'

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
    } catch (error) { return error instanceof Error ? `İşlem kaydedilemedi: ${error.message}` : 'İşlem kaydedilemedi. Tarayıcı depolama ayarlarını kontrol edin.' }
  }
  function save(draft: ReportDraft): string | null {
    if (Object.keys(validateDraft(draft)).length) return 'Bildirim alanlarını kontrol edin.'
    const report: Report = {
      ...draft, label: draft.label.trim(), appearance: draft.appearance.trim(), description: draft.description.trim(),
      occurredAt: new Date(draft.occurredAt).toISOString(), id: crypto.randomUUID(), createdAt: new Date().toISOString(), employee: 'Müslüm', status: 'İnceleme bekliyor',
    }
    const error = mutate(current => ({ ...current, reports: newestFirst([report, ...current.reports]) }), 'Bildiriminiz kaydedildi. Durumu: İnceleme bekliyor.')
    if (!error) { setPage('reports'); setSelectedId(null) }
    return error
  }
  function review(draft: DecisionDraft): string | null {
    if (!selectedId) return 'Önce bir bildirim seçin.'
    const error = mutate(current => addDecision(current, profile, selectedId, draft), 'Yönetici kararı kaydedildi. Bildirim bekleyen listesinden çıkarıldı.')
    if (!error) { setSelectedId(null); setHistory(false) }
    return error
  }
  function removeBan(id: string, reason: string): string | null {
    const error = mutate(current => liftBan(current, profile, id, reason), 'Servis yasağı kaldırıldı. Karar ve kaldırma gerekçesi geçmişte korunuyor.')
    if (!error && page === 'active') setSelectedId(null)
    return error
  }
  function openReport(id: string, target: Page) { setSelectedId(id); setPage(target); setNotice('') }
  function reportList(items: Report[], target: Page = 'reports') {
    if (!items.length) return <Empty title={target === 'admin' ? (history ? 'Henüz karar verilmedi' : 'Bekleyen bildirim yok') : 'Henüz bildiriminiz yok'} text={target === 'admin' ? 'İnceleme ve karar kayıtları burada görünecek.' : 'Olay bildirdiğinizde kayıtlarınız burada görünecek.'} />
    return <ul className="report-list">{items.map(report => {
      const decision = store.decisions.find(d => d.reportId === report.id)
      return <li key={report.id}><button className="report-row" onClick={() => openReport(report.id, target)}><div className="report-info"><strong>{report.label}</strong><span>{report.incidentType} · {formatDate(report.occurredAt)}</span><span className="pending">{decision ? decisionTitle(decision) : 'İnceleme bekliyor'}</span></div><div className="row-end"><SeverityBadge severity={report.severity} /><span aria-hidden="true">↗</span></div></button></li>
    })}</ul>
  }
  function detail(back: string) {
    if (!selected) return null
    return <><section className="panel detail"><button className="text-button" onClick={() => setSelectedId(null)}>← {back}</button><ReportDetails report={selected} /><p className="info-note">Yukarıdaki bilgiler asıl bildirimdir. Bildirimin kendisi servis yasağı oluşturmaz; yönetici kararı ayrı kaydedilir.</p></section>
      {selectedDecision ? <DecisionDetails decision={selectedDecision} now={now} isManager={isManager} onLift={removeBan} /> : page === 'admin' && isManager ? <DecisionForm key={selected.id} onSave={review} /> : <p className="info-note">İnceleme bekliyor. Henüz bir yönetici kararı verilmemiştir.</p>}</>
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="./" onClick={e => { e.preventDefault(); navigate('home') }}><span className="brand-mark" aria-hidden="true">tb<span>•</span></span>TeamBrief</a>
      <p className="sidebar-caption">EKİBİN ORTAK NOKTASI</p>
      <nav aria-label="Ana gezinme" style={{ '--nav-count': visiblePages.length } as React.CSSProperties}>{visiblePages.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}</nav>
      <div className="profile"><span className="avatar" aria-hidden="true">{isManager ? 'A' : 'M'}</span><div><strong>{isManager ? 'Alex' : 'Müslüm'}</strong><small>{isManager ? 'Demo yöneticisi' : 'Demo çalışanı'}</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><strong>Ekip alanı</strong><p className="demo-explanation">Yalnızca demo profil seçimi; gerçek yetkilendirme değildir.</p></div><div className="profile-picker"><label htmlFor="demo-profile">Demo profili</label><select id="demo-profile" value={profile} onChange={e => switchProfile(e.target.value as Profile)}><option value="employee">Müslüm — Çalışan</option><option value="manager">Alex — Yönetici</option></select></div></header>
      <main>
        <div className="page-heading"><div><p className="eyebrow">TEAMBRIEF</p><h1 tabIndex={-1} ref={heading}>{selected ? 'Bildirim ve karar ayrıntıları' : pages.find(p => p.id === page)?.title}</h1><p>{page === 'home' ? `Merhaba ${isManager ? 'Alex' : 'Müslüm'}, ekibin ortak bilgisi burada.` : page === 'create' ? 'Olay bildirimleri demo çalışanı Müslüm adına kaydedilir.' : page === 'active' ? 'Servis sırasında uygulanacak güncel yönetici kararları.' : page === 'admin' ? 'Bildirimleri inceleyin, karar verin ve karar geçmişini takip edin.' : 'Müslüm tarafından oluşturulan bildirimler ve inceleme sonuçları.'}</p></div>{page === 'home' && <button className="primary" onClick={() => navigate('create')}>+ Olay bildir</button>}</div>
        <p className="storage-note">ⓘ Bildirimler ve kararlar yalnızca bu tarayıcıda tutulur. Başka cihazlara aktarılmaz; tarayıcı verileri silinirse kayıtlar kaybolur.</p>
        {storageError && <p className="error-banner" role="alert">{storageError}</p>}
        {notice && <p className="success-banner" role="status">{notice}</p>}
        {page === 'home' && <><div className="stats"><div><span>Toplam bildirim</span><strong>{store.reports.length}</strong><small>Müslüm tarafından oluşturulan</small></div><div><span>İnceleme bekleyen</span><strong>{pending.length}</strong><small>Henüz karar verilmedi</small></div><div><span>Aktif yasak</span><strong>{bans.length}</strong><small>Yalnızca yönetici kararları</small></div></div><section className="panel"><div className="section-heading"><h2>Son bildirimler</h2><button className="text-button" onClick={() => navigate('reports')}>Tümünü gör →</button></div>{reportList(sorted.slice(0, 5))}</section></>}
        {page === 'create' && <ReportForm onSave={save} />}
        {page === 'reports' && (selected ? detail('Bildirimlerime dön') : <section className="panel"><div className="section-heading"><h2>Bildirimlerim <span className="count">{store.reports.length}</span></h2><span className="muted">En yeni kayıt önce</span></div>{reportList(sorted)}</section>)}
        {page === 'admin' && isManager && (selected ? detail('Yönetime dön') : <section className="panel"><div className="section-heading"><div className="tabs" aria-label="İnceleme listesi"><button className={!history ? 'tab active' : 'tab'} aria-pressed={!history} onClick={() => setHistory(false)}>Bekleyenler ({pending.length})</button><button className={history ? 'tab active' : 'tab'} aria-pressed={history} onClick={() => setHistory(true)}>Karar geçmişi ({store.decisions.length})</button></div></div>{reportList(history ? [...store.decisions].sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)).map(d => store.reports.find(r => r.id === d.reportId)!) : newestFirst(pending), 'admin')}</section>)}
        {page === 'active' && <><p className="info-note">Aktif yasakta önem derecesi düşük olsa bile servis izni verilmiş sayılmaz. Servis talimatına uyun. Gözden geçirme tarihi yasağı otomatik kaldırmaz.</p>{selected && selectedDecision?.kind === 'ban' && !selectedDecision.lifted ? <><section className="panel detail"><button className="text-button" onClick={() => setSelectedId(null)}>← Aktif kararlara dön</button><ReportDetails report={selected} /></section><DecisionDetails decision={selectedDecision} now={now} isManager={isManager} onLift={removeBan} /></> : <section className="panel"><div className="section-heading"><h2>Aktif servis yasakları <span className="count">{bans.length}</span></h2></div>{!bans.length ? <Empty title="Aktif servis yasağı yok" text="Yönetici tarafından oluşturulan ve henüz kaldırılmamış yasaklar burada görünür." /> : <ul className="report-list">{[...bans].sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)).map(d => <li key={d.id}><button className="report-row" onClick={() => openReport(d.reportId, 'active')}><div className="report-info"><strong>{store.reports.find(r => r.id === d.reportId)?.label}</strong><span className="instruction-preview">Servis talimatı: {d.instruction}</span><span>Gözden geçirme: {formatDate(d.reviewAt)}</span>{reviewDue(d, now) && <span className="review-warning">Gözden geçirme zamanı geldi</span>}</div><div className="row-end"><SeverityBadge severity={d.severity} /><span aria-hidden="true">↗</span></div></button></li>)}</ul>}</section>}</>}
      </main><footer>Ortak bilgi. Güçlü ekip. Güvenli servis.</footer>
    </div>
  </div>
}
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><span aria-hidden="true">☷</span><h3>{title}</h3><p>{text}</p></div> }
function SeverityBadge({ severity }: { severity: Severity }) { return <span className={`badge ${severity}`}>{severityLabels[severity]} önem</span> }
function ReportDetails({ report }: { report: Report }) {
  return <><div className="detail-heading"><h2>{report.label}</h2><SeverityBadge severity={report.severity} /></div><p className="muted">Bildirimde önerilen önem derecesi</p><dl><div><dt>Bildiren çalışan</dt><dd>{report.employee}</dd></div><div><dt>Olay tarihi ve saati</dt><dd>{formatDate(report.occurredAt)}</dd></div><div><dt>Olay türü</dt><dd>{report.incidentType}</dd></div><div><dt>Oluşturulma tarihi ve saati</dt><dd>{formatDate(report.createdAt)}</dd></div><div className="wide"><dt>Kişiyi ayırt etmeye yardımcı tarif</dt><dd>{report.appearance}</dd></div><div className="wide"><dt>Olayın açıklaması</dt><dd>{report.description}</dd></div></dl></>
}
function DecisionDetails({ decision: d, now, isManager, onLift }: { decision: Decision; now: number; isManager: boolean; onLift: (id: string, reason: string) => string | null }) {
  return <section className="panel detail decision-detail"><div className="detail-heading"><h2>İnceleme sonucu</h2><span className="pending">{decisionTitle(d)}</span></div><dl><div><dt>Kararı veren yönetici</dt><dd>{d.manager}</dd></div><div><dt>Karar zamanı</dt><dd>{formatDate(d.decidedAt)}</dd></div><div className="wide"><dt>Karar açıklaması</dt><dd>{d.explanation}</dd></div>{d.kind === 'ban' && <><div><dt>Son önem derecesi</dt><dd><SeverityBadge severity={d.severity} /></dd></div><div><dt>Gözden geçirme tarihi ve saati</dt><dd>{formatDate(d.reviewAt)}</dd></div><div className="wide"><dt>Servis talimatı</dt><dd className="service-instruction">{d.instruction}</dd></div>{d.lifted && <><div><dt>Yasağı kaldıran yönetici</dt><dd>{d.lifted.manager}</dd></div><div><dt>Kaldırma zamanı</dt><dd>{formatDate(d.lifted.at)}</dd></div><div className="wide"><dt>Kaldırma gerekçesi</dt><dd>{d.lifted.reason}</dd></div></>}</>}</dl>{reviewDue(d, now) && <p className="review-warning" role="status">Gözden geçirme zamanı geldi. Yasak, yönetici kaldırana kadar aktiftir.</p>}{d.kind === 'ban' && !d.lifted && <><p className="info-note">Düşük önem derecesi servis izni anlamına gelmez. Yukarıdaki servis talimatını uygulayın.</p>{isManager && <LiftForm key={d.id} onSave={reason => onLift(d.id, reason)} />}</>}</section>
}
function DecisionForm({ onSave }: { onSave: (draft: DecisionDraft) => string | null }) {
  const [draft, setDraft] = useState<DecisionDraft>({ kind: 'ban', explanation: '', severity: 'medium', instruction: '', reviewAt: '' })
  const [errors, setErrors] = useState<ReturnType<typeof validateDecision>>({})
  const [failure, setFailure] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const saving = useRef(false)
  const [minDate, setMinDate] = useState(localDateTime(new Date(Date.now() + 60000)))
  useEffect(() => { const id = window.setInterval(() => setMinDate(localDateTime(new Date(Date.now() + 60000))), 15000); return () => window.clearInterval(id) }, [])
  function update(field: keyof DecisionDraft, value: string) { setDraft(prev => ({ ...prev, [field]: value })); setErrors({}); setFailure('') }
  function submit(e: FormEvent) {
    e.preventDefault()
    if (saving.current) return
    const result = validateDecision(draft)
    setErrors(result)
    const first = Object.keys(result)[0]
    if (first) { form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return }
    saving.current = true
    const error = onSave(draft)
    if (error) { setFailure(error); saving.current = false }
  }
  const props = (field: keyof DecisionDraft) => ({ id: `decision-${field}`, name: field, required: true, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': `decision-${field}-help${errors[field] ? ` decision-${field}-error` : ''}` })
  const error = (field: keyof DecisionDraft) => errors[field] && <span className="field-error" id={`decision-${field}-error`}>{errors[field]}</span>
  return <form className="panel report-form decision-detail" onSubmit={submit} ref={form} noValidate><div className="section-heading"><h2>Yönetici kararı</h2><span className="muted">Kararı veren: Alex</span></div><div className="form-grid">
    <div className="field wide"><label htmlFor="decision-kind">Karar</label><p id="decision-kind-help">Karar, asıl olay bildiriminden ayrı saklanır.</p><select {...props('kind')} value={draft.kind} onChange={e => update('kind', e.target.value)}><option value="ban">Servis yasağı oluştur</option><option value="no-ban">Devam eden yasak gerekmiyor</option></select>{error('kind')}</div>
    <div className="field wide"><label htmlFor="decision-explanation">Karar açıklaması</label><p id="decision-explanation-help">Her iki karar için de gerekçe zorunludur. Örnek: “Olayın tekrarlanma riski nedeniyle servis yasağı uygulanacak.”</p><textarea {...props('explanation')} rows={3} maxLength={10000} value={draft.explanation} onChange={e => update('explanation', e.target.value)} />{error('explanation')}</div>
    {draft.kind === 'ban' && <><div className="field"><label htmlFor="decision-severity">Son önem derecesi</label><p id="decision-severity-help">Yönetici değerlendirmesi. Düşük önem, servis izni anlamına gelmez.</p><select {...props('severity')} value={draft.severity} onChange={e => update('severity', e.target.value)}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{error('severity')}</div><div className="field"><label htmlFor="decision-reviewAt">Gözden geçirme tarihi ve saati</label><p id="decision-reviewAt-help">Gelecekte bir yerel tarih ve saat seçin. Bu zamanda yasak otomatik kalkmaz.</p><input {...props('reviewAt')} type="datetime-local" min={minDate} value={draft.reviewAt} onFocus={() => setMinDate(localDateTime(new Date(Date.now() + 60000)))} onChange={e => update('reviewAt', e.target.value)} />{error('reviewAt')}</div><div className="field wide"><label htmlFor="decision-instruction">Servis talimatı</label><p id="decision-instruction-help">Personel ne yapmalı? Örnek: “Servis yapmayın; vardiya yöneticisine haber verin.”</p><textarea {...props('instruction')} rows={3} maxLength={10000} value={draft.instruction} onChange={e => update('instruction', e.target.value)} />{error('instruction')}</div></>}
    </div>{Object.keys(errors).length > 0 && <p className="field-error" role="alert">Lütfen işaretlenen karar alanlarını kontrol edin.</p>}{failure && <p className="error-banner" role="alert">{failure}</p>}<div className="form-actions"><button type="submit" className="primary">Kararı kaydet</button></div></form>
}
function LiftForm({ onSave }: { onSave: (reason: string) => string | null }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const saving = useRef(false)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (saving.current) return
    if (!reason.trim()) { setError('Yasağı kaldırma gerekçesi zorunludur.'); input.current?.focus(); return }
    saving.current = true
    const failure = onSave(reason)
    if (failure) { setError(failure); saving.current = false }
  }
  return <form className="lift-form" onSubmit={submit} noValidate><h3>Yasağı kaldır</h3><div className="field"><label htmlFor="lift-reason">Kaldırma gerekçesi</label><p id="lift-help">Neden artık devam eden yasak gerekmiyor? Bu açıklama yönetici ve zaman bilgisiyle geçmişte saklanır.</p><textarea id="lift-reason" ref={input} required rows={3} maxLength={10000} value={reason} aria-invalid={Boolean(error)} aria-describedby={`lift-help${error ? ' lift-error' : ''}`} onChange={e => { setReason(e.target.value); setError('') }} />{error && <p className="field-error" id="lift-error" role="alert">{error}</p>}</div><div className="form-actions"><button className="primary" type="submit">Gerekçeyle yasağı kaldır</button></div></form>
}
function ReportForm({ onSave }: { onSave: (draft: ReportDraft) => string | null }) {
  const [draft, setDraft] = useState<ReportDraft>({ label: '', occurredAt: '', incidentType: '', severity: 'medium', appearance: '', description: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveError, setSaveError] = useState('')
  const [maxDate, setMaxDate] = useState(localDateTime())
  const form = useRef<HTMLFormElement>(null)
  const saving = useRef(false)
  useEffect(() => { const timer = window.setInterval(() => setMaxDate(localDateTime()), 15000); return () => window.clearInterval(timer) }, [])
  function update(field: keyof ReportDraft, value: string) {
    setDraft(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: undefined }))
    setSaveError('')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    const nextErrors = validateDraft(draft)
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) { form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(); return }
    saving.current = true
    const failure = onSave(draft)
    if (failure) { setSaveError(failure); saving.current = false }
  }
  function fieldProps(field: keyof ReportDraft) {
    return { id: field, name: field, required: true, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': `${field}-help${errors[field] ? ` ${field}-error` : ''}` }
  }
  const error = (field: keyof ReportDraft) => errors[field] && <span className="field-error" id={`${field}-error`}>{errors[field]}</span>
  return <form className="panel report-form" ref={form} onSubmit={submit} noValidate>
    <div className="section-heading"><h2>Olay bilgileri</h2><span className="muted">Tüm alanlar zorunludur</span></div>
    <div className="form-grid">
      <div className="field"><label htmlFor="label">Kişi için kısa etiket</label><p id="label-help">Kişiyi hatırlamanızı sağlayacak kısa bir ad. Örnek: “Mavi ceketli misafir”.</p><input {...fieldProps('label')} value={draft.label} maxLength={100} placeholder="Örn. Mavi ceketli misafir" onChange={e => update('label', e.target.value)} />{error('label')}</div>
      <div className="field"><label htmlFor="occurredAt">Olay tarihi ve saati</label><p id="occurredAt-help">Olayın gerçekleştiği yerel saati girin. Gelecekte bir zaman seçilemez.</p><input {...fieldProps('occurredAt')} type="datetime-local" max={maxDate} value={draft.occurredAt} onFocus={() => setMaxDate(localDateTime())} onChange={e => update('occurredAt', e.target.value)} />{error('occurredAt')}</div>
      <div className="field"><label htmlFor="incidentType">Olay türü</label><p id="incidentType-help">Gözlemlediğiniz duruma en yakın türü seçin.</p><select {...fieldProps('incidentType')} value={draft.incidentType} onChange={e => update('incidentType', e.target.value)}><option value="">Olay türü seçin</option>{incidentTypes.map(type => <option key={type}>{type}</option>)}</select>{error('incidentType')}</div>
      <div className="field"><label htmlFor="severity">Önerilen önem derecesi</label><p id="severity-help">Düşük: sınırlı etki · Orta: müdahale gerekti · Yüksek: ciddi güvenlik riski.</p><select {...fieldProps('severity')} value={draft.severity} onChange={e => update('severity', e.target.value)}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{error('severity')}</div>
      <div className="field wide"><label htmlFor="appearance">Kişiyi ayırt etmeye yardımcı tarif</label><p id="appearance-help">Gözlemlenebilir özellikleri yazın. Örnek: “Mavi ceket, yuvarlak gözlük, kısa saç”.</p><textarea {...fieldProps('appearance')} rows={3} maxLength={2000} value={draft.appearance} placeholder="Kıyafet ve ayırt edici özellikler…" onChange={e => update('appearance', e.target.value)} />{error('appearance')}</div>
      <div className="field wide"><label htmlFor="description">Olayın açıklaması</label><p id="description-help">Ne oldu, nerede oldu, nasıl müdahale edildi? Örnek: “Bar önünde bağırdı. Sakinleşmesi istendi ve mekândan ayrıldı.”</p><textarea {...fieldProps('description')} rows={5} maxLength={10000} value={draft.description} placeholder="Olayı gözlemlerinize dayanarak anlatın…" onChange={e => update('description', e.target.value)} />{error('description')}</div>
    </div>
    <p className="info-note">Bildiren: <strong>Müslüm</strong> · Yeni kayıt “İnceleme bekliyor” durumunda saklanır. Bildirim otomatik servis yasağı oluşturmaz.</p>
    {Object.keys(errors).some(key => errors[key as keyof ReportDraft]) && <p className="field-error" role="alert">Lütfen işaretlenen alanları kontrol edin.</p>}
    {saveError && <p className="error-banner" role="alert">{saveError}</p>}
    <div className="form-actions"><button className="primary" type="submit">Bildirimi kaydet →</button></div>
  </form>
}
export default App
