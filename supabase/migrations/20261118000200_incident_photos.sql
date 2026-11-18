insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos', 'incident-photos', false, 5000000, array['image/jpeg', 'image/png', 'image/webp']);

-- A reservation authorizes one immutable Storage object before a report exists.
create table teambrief_private.incident_photo_uploads (
  venue_id uuid not null,
  report_id uuid not null,
  user_id uuid not null,
  upload_id uuid not null,
  object_path text not null unique,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  abandoned_at timestamptz,
  committed boolean not null default false,
  primary key (venue_id, report_id, user_id, upload_id),
  check (not committed or abandoned_at is null)
);

create index incident_photo_uploads_cleanup_idx on teambrief_private.incident_photo_uploads(expires_at)
  where not committed;

alter table teambrief_private.incident_photo_uploads enable row level security;
revoke all on teambrief_private.incident_photo_uploads from public, anon, authenticated;

create table public.incident_photos (
  report_id uuid primary key,
  venue_id uuid not null,
  bucket_id text not null default 'incident-photos' check (bucket_id = 'incident-photos'),
  object_path text not null unique,
  foreign key (venue_id, report_id) references public.incident_reports(venue_id, id) on delete restrict
);

alter table public.incident_photos enable row level security;
revoke all on public.incident_photos from public, anon, authenticated;
grant select on public.incident_photos to authenticated;

create function teambrief_private.can_read_incident_photo(p_venue_id uuid, p_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select teambrief_private.is_member(p_venue_id) and (
    teambrief_private.owns_report(p_venue_id, p_report_id)
    or teambrief_private.is_manager(p_venue_id)
    or exists (
      select 1 from public.decisions d where d.venue_id = p_venue_id and d.report_id = p_report_id
        and d.kind = 'ban' and d.lifted_at is null
    )
  );
$$;

create policy incident_photo_member_read on public.incident_photos for select to authenticated
  using (teambrief_private.can_read_incident_photo(venue_id, report_id));

create function teambrief_private.can_upload_incident_photo(p_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from teambrief_private.incident_photo_uploads u
    where u.object_path = p_path and u.user_id = (select auth.uid())
      and not u.committed and u.abandoned_at is null and u.expires_at > statement_timestamp()
      and teambrief_private.is_member(u.venue_id)
    for share;
  return found;
end;
$$;

create function teambrief_private.can_remove_abandoned_photo(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from teambrief_private.incident_photo_uploads u
      where u.object_path = p_path and u.user_id = (select auth.uid())
        and not u.committed and u.abandoned_at is not null
        and teambrief_private.is_member(u.venue_id)
  );
$$;

create policy incident_photo_upload_reserved on storage.objects for insert to authenticated
  with check (
    bucket_id = 'incident-photos'
    and owner_id = (select auth.uid())::text
    and teambrief_private.can_upload_incident_photo(name)
  );

-- Limit the SELECT grant to authenticated downloads. Listing, signing, and
-- creating signed upload URLs must not inherit download permission.
create policy incident_photo_download on storage.objects for select to authenticated
  using (
    bucket_id = 'incident-photos'
    and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
    and exists (select 1 from public.incident_photos p where p.object_path = name)
  );

create policy incident_photo_abandoned_select on storage.objects for select to authenticated
  using (
    bucket_id = 'incident-photos' and storage.allow_only_operation('object.delete_many')
    and teambrief_private.can_remove_abandoned_photo(name)
  );

create policy incident_photo_abandoned_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'incident-photos' and storage.allow_only_operation('object.delete_many')
    and teambrief_private.can_remove_abandoned_photo(name)
  );

create function public.prepare_incident_photo(p_venue_id uuid, p_report_id uuid, p_upload_id uuid)
returns table (object_path text, uploaded boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_upload teambrief_private.incident_photo_uploads;
begin
  v_user := teambrief_private.require_member(p_venue_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_report_id::text, 0));
  select u.* into v_upload from teambrief_private.incident_photo_uploads u
    where u.venue_id = p_venue_id and u.report_id = p_report_id and u.user_id = v_user
      and u.upload_id = p_upload_id;
  if not found then
    if exists (select 1 from public.incident_reports r where r.id = p_report_id) then
      raise exception using errcode = '55000', message = 'This incident is already saved. Open My Incidents to view it.';
    end if;
    insert into teambrief_private.incident_photo_uploads (venue_id, report_id, user_id, upload_id, object_path)
      values (p_venue_id, p_report_id, v_user, p_upload_id, p_venue_id::text || '/' || p_report_id::text || '/' || gen_random_uuid()::text)
      returning * into v_upload;
  end if;
  if not v_upload.committed and (v_upload.abandoned_at is not null or v_upload.expires_at <= statement_timestamp()) then
    raise exception using errcode = '55000', message = 'The upload expired or was discarded. Select the photo again.';
  end if;
  return query select v_upload.object_path, exists (
    select 1 from storage.objects o
      where o.bucket_id = 'incident-photos' and o.name = v_upload.object_path and o.owner_id = v_user::text
  );
end;
$$;

create function public.abandon_incident_photo(p_venue_id uuid, p_report_id uuid, p_upload_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_path text;
begin
  v_user := teambrief_private.require_member(p_venue_id);
  update teambrief_private.incident_photo_uploads u
    set abandoned_at = coalesce(u.abandoned_at, statement_timestamp())
    where u.venue_id = p_venue_id and u.report_id = p_report_id and u.user_id = v_user
      and u.upload_id = p_upload_id and not u.committed
    returning u.object_path into v_path;
  return v_path;
end;
$$;

create function public.submit_incident_report(
  p_venue_id uuid, p_report_id uuid, p_label text, p_occurred_at timestamptz,
  p_incident_type text, p_severity text, p_appearance text, p_description text, p_photo_path text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_existing public.incident_reports;
  v_saved_path text;
begin
  -- Serialize submit against removal of membership as well as duplicate requests.
  select m.user_id into v_user from public.venue_memberships m
    where m.venue_id = p_venue_id and m.user_id = (select auth.uid()) and m.is_active
    for share;
  if not found then raise exception using errcode = '42501', message = 'Active pub membership required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_report_id::text, 0));
  select r.* into v_existing from public.incident_reports r where r.id = p_report_id;
  if found then
    if v_existing.venue_id <> p_venue_id or v_existing.reported_by <> v_user then
      raise exception using errcode = '42501', message = 'Incident unavailable';
    end if;
    select p.object_path into v_saved_path from public.incident_photos p where p.report_id = p_report_id;
    if row(v_existing.label, v_existing.occurred_at, v_existing.incident_type, v_existing.severity,
           v_existing.appearance, v_existing.description, v_saved_path) is distinct from
       row(p_label, p_occurred_at, p_incident_type, p_severity, p_appearance, p_description, p_photo_path) then
      raise exception using errcode = '55000', message = 'This incident was already saved with different details. Open My Incidents to view it.';
    end if;
    return p_report_id;
  end if;

  if p_photo_path is not null then
    update teambrief_private.incident_photo_uploads u set committed = true
      where u.object_path = p_photo_path and u.venue_id = p_venue_id and u.report_id = p_report_id
        and u.user_id = v_user and not u.committed and u.abandoned_at is null
        and u.expires_at > statement_timestamp();
    if not found then raise exception using errcode = '42501', message = 'Photo upload unavailable. Select the photo again.'; end if;

    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'incident-photos' and o.name = p_photo_path
        and o.owner_id = v_user::text
        and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
        and (o.metadata ->> 'size')::bigint between 1 and 5000000
    ) then
      raise exception using errcode = '23514', message = 'Photo upload incomplete. Retry submitting the report.';
    end if;
  end if;

  insert into public.incident_reports (id, venue_id, label, occurred_at, incident_type, severity, appearance, description)
    values (p_report_id, p_venue_id, p_label, p_occurred_at, p_incident_type, p_severity, p_appearance, p_description);
  if p_photo_path is not null then
    insert into public.incident_photos (report_id, venue_id, object_path)
      values (p_report_id, p_venue_id, p_photo_path);
  end if;
  update teambrief_private.incident_photo_uploads u
    set abandoned_at = coalesce(u.abandoned_at, statement_timestamp())
    where u.venue_id = p_venue_id and u.report_id = p_report_id and u.user_id = v_user and not u.committed;
  return p_report_id;
end;
$$;

revoke all on function teambrief_private.can_read_incident_photo(uuid, uuid),
  teambrief_private.can_upload_incident_photo(text), teambrief_private.can_remove_abandoned_photo(text),
  public.prepare_incident_photo(uuid, uuid, uuid), public.abandon_incident_photo(uuid, uuid, uuid),
  public.submit_incident_report(uuid, uuid, text, timestamptz, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function teambrief_private.can_read_incident_photo(uuid, uuid),
  teambrief_private.can_upload_incident_photo(text), teambrief_private.can_remove_abandoned_photo(text),
  public.prepare_incident_photo(uuid, uuid, uuid), public.abandon_incident_photo(uuid, uuid, uuid),
  public.submit_incident_report(uuid, uuid, text, timestamptz, text, text, text, text, text)
  to authenticated;
