import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LiftForm } from './App.tsx'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findActiveBans } from './backend.ts'
import type { ActiveBan, BanCursor } from './backend.ts'
import { IncidentPhoto } from './IncidentPhoto.tsx'
import { formatDate, severityLabels } from './reports.ts'

const compactQuery = '(max-width: 700px)'
function compactHome() { return typeof window.matchMedia === 'function' && window.matchMedia(compactQuery).matches }
function watchWidth(change: () => void) {
  const media = window.matchMedia?.(compactQuery)
  media?.addEventListener('change', change)
  return () => media?.removeEventListener('change', change)
}

type Base = { client: SupabaseClient; venueId: string; refreshVersion: number; now: number }
type Results = Awaited<ReturnType<typeof findActiveBans>>
function useBanResults({ client, venueId, refreshVersion }: Base, query: string, limit: number, cursor?: BanCursor, id?: string) {
  const [state, setState] = useState<{ result?: Results; failed?: boolean }>({})
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      findActiveBans(client, venueId, query, limit, controller.signal, cursor, id).then(result => {
        if (!controller.signal.aborted) setState({ result })
      }).catch(() => {
        if (!controller.signal.aborted) setState({ failed: true })
      })
    }, query ? 275 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [client, venueId, refreshVersion, query, limit, cursor, id, retry])
  return { ...state, retry: () => { setState({}); setRetry(n => n + 1) } }
}

function BanFacts({ ban, now }: { ban: ActiveBan; now: number }) {
  return <>
    <p className="ban-appearance">{ban.appearance}</p>
    <p className="ban-instruction"><strong>Service instructions</strong> {ban.instruction}</p>
    <div className="ban-dates">
      <span>Decision <time dateTime={ban.decided_at}>{formatDate(ban.decided_at)}</time></span>
      <span>Review due <time dateTime={ban.review_at}>{formatDate(ban.review_at)}</time></span>
      {Date.parse(ban.review_at) <= now && <span className="review-warning">Review overdue</span>}
    </div>
  </>
}
function BanPhoto({ client, ban, compact }: { client: SupabaseClient; ban: ActiveBan; compact?: boolean }) {
  return <IncidentPhoto client={client} photo={ban.photo_path ? { path: ban.photo_path, reportId: ban.report_id } : undefined}
    label={ban.label} compact={compact} />
}

type Directory = Base & {
  home: boolean; query: string; onQuery: (query: string) => void
  onOpen: (id: string) => void; onAll: (query: string) => void
}
export function ActiveBanDirectory(props: Directory) {
  const compact = useSyncExternalStore(watchWidth, compactHome, () => false)
  const limit = props.home && compact ? 5 : 20
  const query = props.query.trim()
  const heading = useRef<HTMLHeadingElement>(null)
  return <section className="panel ban-directory" aria-labelledby="active-bans-heading">
    <div className="ban-directory-heading">
      <h2 id="active-bans-heading" ref={heading} tabIndex={-1}>Active service bans</h2>
      <div className="ban-search">
        <label htmlFor="ban-search">Search by person label or physical description</label>
        <div>
          <input id="ban-search" type="search" maxLength={200} value={props.query} onChange={e => props.onQuery(e.target.value)} />
          {props.query && <button type="button" className="secondary-button" onClick={() => props.onQuery('')}>Clear</button>}
        </div>
      </div>
    </div>
    <BanPages key={JSON.stringify([query, limit, props.home])} {...props} query={query} limit={limit} onPageChange={() => heading.current?.focus()} />
  </section>
}
function BanPages(props: Directory & { limit: number; onPageChange: () => void }) {
  const [cursors, setCursors] = useState<BanCursor[]>([])
  return <BanPage key={cursors.length} {...props} cursor={cursors.at(-1)} page={cursors.length + 1}
    onPrevious={() => { props.onPageChange(); setCursors(previous => previous.slice(0, -1)) }}
    onNext={cursor => { props.onPageChange(); setCursors(previous => [...previous, cursor]) }} />
}
function BanPage(props: Directory & {
  limit: number; cursor?: BanCursor; page: number; onPrevious: () => void; onNext: (cursor: BanCursor) => void
}) {
  const { client, home, limit, query, now, onOpen, onAll } = props
  const { result, failed, retry } = useBanResults(props, query, limit, props.cursor)
  const next = result?.next
  return <>
    {failed ? <div className="ban-status" role="alert">Could not load active bans. <button className="secondary-button" onClick={retry}>Retry</button></div>
      : !result ? <p className="ban-status" role="status">Loading active bans…</p>
      : !result.items.length ? <p className="ban-status" role="status">{props.page > 1 ? 'No more results on this page.' : query ? 'No matching active bans.' : 'No active service bans.'}</p>
      : <div className={home ? 'ban-scroll' : undefined} tabIndex={home && limit === 20 ? 0 : undefined}
          role={home ? 'region' : undefined} aria-label={home ? 'Active ban results' : undefined}>
        <ul className="report-list">{result.items.map(ban => <li className="ban-row" key={ban.decision_id}>
          <BanPhoto client={client} ban={ban} compact />
          <div className="ban-copy">
            <div className="ban-row-heading">
              <button className="ban-person" onClick={() => onOpen(ban.decision_id)}>{ban.label}</button>
              <span className={`badge ${ban.severity}`}>{severityLabels[ban.severity]}</span>
            </div>
            <BanFacts ban={ban} now={now} />
          </div>
        </li>)}</ul>
      </div>}
    {home ? <div className="ban-directory-footer">
      <span className="muted">Home shows up to {limit} {query ? 'matching bans' : 'of the latest active bans'}.</span>
      <button className="secondary-button" onClick={() => onAll(query)}>{query ? 'View all results' : 'View all active bans'}</button>
    </div> : (props.page > 1 || next) && <div className="ban-directory-footer">
      <button className="secondary-button" disabled={props.page === 1} onClick={props.onPrevious}>Previous</button>
      <span className="muted" role="status">Page {props.page}</span>
      <button className="secondary-button" disabled={!next} onClick={() => { if (next) props.onNext(next) }}>Next</button>
    </div>}
  </>
}

export function ActiveBanDetail(props: Base & { id: string; onLift?: (id: string, reason: string, note: string) => Promise<string | null> }) {
  const { result, failed, retry } = useBanResults(props, '', 1, undefined, props.id)
  const ban = result?.items[0]
  const lift = props.onLift
  if (failed) return <div role="alert" className="error-banner">Could not load this ban. <button className="secondary-button" onClick={retry}>Retry</button></div>
  if (!result) return <p role="status">Loading active ban…</p>
  if (!ban) return <p role="status">This service ban is no longer active.</p>
  return <section className="panel detail ban-detail">
    <div className="ban-row-heading"><h2>{ban.label}</h2><span className={`badge ${ban.severity}`}>{severityLabels[ban.severity]}</span></div>
    <BanPhoto client={props.client} ban={ban} />
    <BanFacts ban={ban} now={props.now} />
    <p className="info-note">A service ban remains active until a manager lifts it.</p>
    {lift && <LiftForm onSave={(reason, note) => lift(ban.decision_id, reason, note)} showServiceNote />}
  </section>
}
