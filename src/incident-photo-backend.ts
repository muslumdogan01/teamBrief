import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportDraft } from './reports.ts'
import { checked } from './backend.ts'
import { photoBucket, validateIncidentPhoto } from './incident-photo-files.ts'

export function photoRequest(venueId: string, reportId: string, uploadId: string) {
  return { p_venue_id: venueId, p_report_id: reportId, p_upload_id: uploadId }
}

export type PhotoSubmission = { reportId: string; photo?: { file: File; uploadId: string } }

export async function submitIncident(
  client: SupabaseClient, venueId: string, draft: ReportDraft, attempt: PhotoSubmission,
  progress: (stage: string) => void, signal?: AbortSignal,
) {
  let path: string | null = null
  if (attempt.photo) {
    const { file, uploadId } = attempt.photo
    const contentType = await validateIncidentPhoto(file)
    signal?.throwIfAborted()
    progress('Preparing photo upload…')
    const reservation = checked(await client.rpc('prepare_incident_photo', photoRequest(venueId, attempt.reportId, uploadId)).single<{ object_path: string; uploaded: boolean }>())
    if (!reservation) throw new Error('Unable to prepare the photo upload. Please retry.')
    path = reservation.object_path
    signal?.throwIfAborted()
    if (!reservation.uploaded) {
      progress('Uploading photo…')
      // Use the validated type even if a browser returned a File without a MIME type.
      const content = file.slice(0, file.size, contentType)
      const { error } = await client.storage.from(photoBucket).upload(path, content, { contentType, upsert: false, cacheControl: '0' })
      if (error) throw new Error('Photo upload could not be confirmed. Retry submitting the report, or replace the photo.')
    }
  }

  signal?.throwIfAborted()
  progress('Saving incident report…')
  const result = await client.rpc('submit_incident_report', {
    p_venue_id: venueId, p_report_id: attempt.reportId, p_label: draft.label,
    p_occurred_at: new Date(draft.occurredAt).toISOString(), p_incident_type: draft.incidentType,
    p_severity: draft.severity, p_appearance: draft.appearance, p_description: draft.description, p_photo_path: path,
  })
  if (result.error && (result.status === 0 || [502, 503, 504].includes(result.status) || (result.status === 500 && !result.error.code))) {
    throw new Error('Saving could not be confirmed. Keep this form open and retry to check the same report.')
  }
  return checked(result)
}

export async function discardIncidentPhoto(client: SupabaseClient, venueId: string, reportId: string, uploadId: string) {
  const path = checked<string | null>(await client.rpc('abandon_incident_photo', photoRequest(venueId, reportId, uploadId)))
  if (path) checked(await client.storage.from(photoBucket).remove([path]))
}
