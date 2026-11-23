create or replace function teambrief_private.can_read_incident_photo(p_venue_id uuid, p_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select teambrief_private.is_member(p_venue_id) and (
    teambrief_private.owns_report(p_venue_id, p_report_id)
    or teambrief_private.is_manager(p_venue_id)
    or exists (
      select 1 from public.decisions d
      where d.venue_id = p_venue_id and d.report_id = p_report_id and d.kind = 'ban'
        and (d.lifted_at is null or exists (
          select 1 from public.venue_updates u
          where u.venue_id = d.venue_id and u.decision_id = d.id and u.event_type = 'ban_lifted'
        ))
    )
  );
$$;

create function public.find_lift_updates(
  p_venue_id uuid, p_query text default '', p_limit integer default 20,
  p_before_at timestamptz default null, p_before_id uuid default null
)
returns table(id uuid, person_label text, service_note text, occurred_at timestamptz,
  read_at timestamptz, photo_path text, has_more boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if not teambrief_private.is_member(p_venue_id) then
    raise exception using errcode = '42501', message = 'Venue access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 20 or char_length(v_query) > 200
      or (p_before_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'Invalid updates search';
  end if;

  return query
  with batch as (
    select u.id, u.person_label, u.service_note, u.occurred_at, receipt.read_at, p.object_path
    from public.venue_updates u
    join public.decisions d on d.venue_id = u.venue_id and d.id = u.decision_id
    join public.incident_reports incident on incident.venue_id = d.venue_id and incident.id = d.report_id
    left join public.incident_photos p on p.venue_id = incident.venue_id and p.report_id = incident.id
    left join public.venue_update_reads receipt on receipt.update_id = u.id and receipt.user_id = (select auth.uid())
    where u.venue_id = p_venue_id and u.event_type = 'ban_lifted'
      and d.kind = 'ban' and d.lifted_at is not null
      and (p_before_at is null or (u.occurred_at, u.id) < (p_before_at, p_before_id))
      and (v_query = '' or strpos(lower(u.person_label), v_query) > 0 or strpos(lower(incident.appearance), v_query) > 0)
    order by u.occurred_at desc, u.id desc
    limit p_limit + 1
  )
  select b.*, count(*) over () > p_limit
  from batch b order by b.occurred_at desc, b.id desc
  limit p_limit;
end;
$$;

create function public.count_unread_lift_updates(p_venue_id uuid)
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(*) from public.venue_updates u
  where u.venue_id = p_venue_id and u.event_type = 'ban_lifted'
    and not exists (
      select 1 from public.venue_update_reads receipt
      where receipt.update_id = u.id and receipt.user_id = (select auth.uid())
    );
$$;

revoke all on function public.find_lift_updates(uuid, text, integer, timestamptz, uuid),
  public.count_unread_lift_updates(uuid) from public, anon, authenticated;
grant execute on function public.find_lift_updates(uuid, text, integer, timestamptz, uuid),
  public.count_unread_lift_updates(uuid) to authenticated;
