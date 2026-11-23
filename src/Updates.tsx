import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countUnreadLiftUpdates, findLiftUpdates, markUpdateRead } from './backend.ts'
import type { UpdateCursor } from './backend.ts'
import { IncidentPhoto } from './IncidentPhoto.tsx'
import { formatDate } from './reports.ts'

type Props = {
  client: SupabaseClient; venueId: string; refreshVersion: number; recent: boolean
  onAll: () => void; onActive: () => void
}
type Results = Awaited<ReturnType<typeof findLiftUpdates>>

export function Updates({ client, venueId, refreshVersion, recent, onAll, onActive }: Props) {
  const [query, setQuery] = useState('')
  const [readRevision, setReadRevision] = useState(0)
  const [saving, setSaving] = useState<string | null>(null)
  const [readError, setReadError] = useState(false)
  const [unread, setUnread] = useState<number | null>(null)
  useEffect(() => {
    const request = new AbortController()
    countUnreadLiftUpdates(client, venueId, request.signal).then(count => {
      if (!request.signal.aborted) setUnread(count)
    }).catch(() => { if (!request.signal.aborted) setUnread(null) })
    return () => request.abort()
  }, [client, venueId, refreshVersion, readRevision])

  async function read(id: string) {
    setSaving(id)
    setReadError(false)
    try {
      await markUpdateRead(client, venueId, id)
      setReadRevision(value => value + 1)
    } catch { setReadError(true) }
    finally { setSaving(null) }
  }
  return <section className="panel detail recent-updates" aria-label={recent ? 'Recent Updates' : 'Lift history'}>
    {recent ? <h2>Recent Updates</h2> : <div className="ban-search">
      <label htmlFor="updates-search">Search by person label or physical description</label>
      <div>
        <input id="updates-search" type="search" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button className="secondary-button" onClick={() => setQuery('')}>Clear</button>}
      </div>
    </div>}
    <p className="info-note">This is a past update. Check Active Decisions for current restrictions.</p>
    <a className="text-button" href="#active-decisions" onClick={event => { event.preventDefault(); onActive() }}>Active Decisions</a>
    {readError && <p className="error-banner" role="alert">Could not mark the update as read. Please try again.</p>}
    {unread !== null && <p className="muted">Unread in this pub: {unread}</p>}
    <UpdatePages key={query.trim()} client={client} venueId={venueId} refreshVersion={refreshVersion}
      recent={recent} query={query.trim()}
      readRevision={readRevision} saving={saving} onRead={read} />
    {recent && <button className="secondary-button" onClick={onAll}>View all updates</button>}
  </section>
}

function UpdatePages({ client, venueId, refreshVersion, recent, query, readRevision, saving, onRead }: Omit<Props, 'onAll' | 'onActive'> & {
  query: string; readRevision: number; saving: string | null; onRead: (id: string) => Promise<void>
}) {
  const [cursors, setCursors] = useState<UpdateCursor[]>([])
  const [view, setView] = useState<{ result?: Results; failed?: boolean }>({})
  const [revision, setRevision] = useState(0)
  const cursor = cursors.at(-1)

  useEffect(() => {
    const request = new AbortController()
    const timer = window.setTimeout(() => {
      findLiftUpdates(client, venueId, query, recent ? 5 : 20, request.signal, cursor).then(result => {
        if (!request.signal.aborted) setView({ result })
      }).catch(() => { if (!request.signal.aborted) setView({ failed: true }) })
    }, query ? 275 : 0)
    return () => { window.clearTimeout(timer); request.abort() }
  }, [client, venueId, query, recent, cursor, refreshVersion, readRevision, revision])

  const { result, failed } = view
  const next = result?.next
  return <>
    {failed ? <p role="alert">Could not load updates. <button className="secondary-button" onClick={() => {
      setView({}); setRevision(value => value + 1)
    }}>Retry</button></p> : !result ? <p role="status">Loading updates…</p> : result.items.length ? (
      <ul className="report-list">{result.items.map(update => <li key={update.id} className="ban-row update-row">
        <IncidentPhoto client={client} photo={update.photo_path ? { path: update.photo_path } : undefined}
          label={update.person_label} compact />
        <div className="ban-copy">
          <div className="ban-row-heading"><h3>{update.person_label}</h3><span className="badge decision-status ban-lifted">Ban lifted</span></div>
          <p>Lifted <time dateTime={update.occurred_at}>{formatDate(update.occurred_at)}</time> · <span>{update.read_at ? 'Read' : 'Unread'}</span></p>
          <p className="service-instruction"><strong>Service note at time of lifting</strong><br />{update.service_note}</p>
          {!update.read_at && <button className="secondary-button" disabled={saving !== null}
            onClick={() => { void onRead(update.id) }}>{saving === update.id ? 'Saving…' : 'Mark as read'}</button>}
        </div>
      </li>)}</ul>
    ) : <p className="empty">{cursors.length ? 'No more updates on this page.' : query ? 'No matching updates.' : 'No lift updates yet.'}</p>}
    {!recent && (cursors.length > 0 || next) && <div className="ban-directory-footer">
      <button className="secondary-button" disabled={!cursors.length || saving !== null} onClick={() => {
        setView({}); setCursors(previous => previous.slice(0, -1))
      }}>Previous</button>
      <span className="muted">Page {cursors.length + 1}</span>
      <button className="secondary-button" disabled={!next || saving !== null} onClick={() => {
        if (next) { setView({}); setCursors(previous => [...previous, next]) }
      }}>Next</button>
    </div>}
  </>
}
