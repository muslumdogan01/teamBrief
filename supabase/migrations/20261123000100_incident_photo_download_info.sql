-- Hosted Storage checks authenticated object info before serving private downloads.
-- Apply the same attachment and membership policy to both operations.
alter policy incident_photo_download on storage.objects using (
  bucket_id = 'incident-photos'
  and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
  and exists (
    select 1 from public.incident_photos p
    where p.bucket_id = objects.bucket_id and p.object_path = objects.name
  )
);
