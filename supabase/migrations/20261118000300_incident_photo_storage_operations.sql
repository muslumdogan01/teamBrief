-- A reservation permits only the regular upload route. The same INSERT grant
-- must not authorize signing an upload URL or starting another upload protocol.
alter policy incident_photo_upload_reserved on storage.objects with check (
  bucket_id = 'incident-photos'
  and storage.allow_only_operation('object.upload')
  and owner_id = (select auth.uid())::text
  and teambrief_private.can_upload_incident_photo(name)
);

alter policy incident_photo_download on storage.objects using (
  bucket_id = 'incident-photos'
  and storage.allow_only_operation('object.get_authenticated')
  and exists (select 1 from public.incident_photos p where p.object_path = name)
);
