import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IncidentPhotoRef } from './backend.ts'
import { checked } from './backend.ts'
import { photoBucket, validateIncidentPhoto } from './incident-photo-files.ts'

import { useObjectUrl } from './use-object-url.ts'

export function IncidentPhoto({ client, photo, label, compact = false }: {
  client: SupabaseClient; photo?: IncidentPhotoRef; label: string; compact?: boolean
}) {
  const slot = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(!compact || typeof IntersectionObserver === 'undefined')
  const [photoState, setPhotoState] = useState<{ path: string; file: Blob | null } | null>(null)
  const path = photo?.path
  const file = photoState?.path === path ? photoState?.file ?? null : null
  const url = useObjectUrl(file)

  useEffect(() => {
    const node = slot.current
    if (!path || visible || !node) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [path, visible])

  useEffect(() => {
    if (!path || !visible) return
    const controller = new AbortController()
    async function download(objectPath: string) {
      try {
        const result = checked(await client.storage.from(photoBucket).download(objectPath, {}, { signal: controller.signal, cache: 'no-store' }))
        if (!result) throw new Error('Photo unavailable')
        await validateIncidentPhoto(result)
        if (!controller.signal.aborted) setPhotoState({ path: objectPath, file: result })
      } catch {
        if (!controller.signal.aborted) setPhotoState({ path: objectPath, file: null })
      }
    }
    void download(path)
    return () => controller.abort()
  }, [client, path, visible])

  return <div ref={slot} className={compact ? 'incident-photo compact' : 'incident-photo'}>
    {!path ? <span className="photo-placeholder">No photo</span> : !url ? (
      <span className="photo-placeholder">{photoState?.path === path && !file ? 'Photo unavailable' : 'Loading photo…'}</span>
    ) : <>
      <button ref={opener} type="button" className="photo-open" aria-label={`View incident photo for ${label}`} onClick={() => dialog.current?.showModal()}>
        <img src={url} alt={`Incident photo for ${label}`} onError={() => setPhotoState({ path, file: null })} />
      </button>
      <dialog ref={dialog} className="photo-dialog" aria-label={`Incident photo for ${label}`} onClose={() => opener.current?.focus()}>
        <form method="dialog"><button autoFocus>Close photo</button></form>
        <img src={url} alt={`Incident photo for ${label}`} />
      </dialog>
    </>}
  </div>
}
