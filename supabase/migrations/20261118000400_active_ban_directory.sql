create index decisions_active_directory_idx
  on public.decisions(venue_id, decided_at desc, id desc)
  where kind = 'ban' and lifted_at is null;

create function public.get_teambrief_totals(p_venue_id uuid)
returns table(active_bans bigint, my_incidents bigint, awaiting_review bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not teambrief_private.is_member(p_venue_id) then
    raise exception using errcode = '42501', message = 'Venue access denied';
  end if;
  return query select
    (select count(*) from public.decisions d where d.venue_id = p_venue_id and d.kind = 'ban' and d.lifted_at is null),
    (select count(*) from public.incident_reports r where r.venue_id = p_venue_id and r.reported_by = (select auth.uid())),
    case when teambrief_private.is_manager(p_venue_id) then (
      select count(*) from public.incident_reports r where r.venue_id = p_venue_id
        and not exists (select 1 from public.decisions d where d.report_id = r.id)
    ) end;
end;
$$;

create function public.find_active_bans(
  p_venue_id uuid, p_query text default '', p_limit integer default 20,
  p_before_at timestamptz default null, p_before_id uuid default null,
  p_decision_id uuid default null
)
returns table(decision_id uuid, report_id uuid, label text, appearance text, severity text,
  instruction text, decided_at timestamptz, review_at timestamptz, photo_path text, has_more boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if not teambrief_private.is_member(p_venue_id) then
    raise exception using errcode = '42501', message = 'Venue access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 20 or char_length(v_query) > 200
      or (p_before_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'Invalid active ban search';
  end if;
  return query
    with batch as (
    select d.id as ban_id, r.id as incident_id, r.label as person_label, r.appearance as person_appearance,
      d.severity as ban_severity, d.instruction as service_instruction, d.decided_at as decision_time,
      d.review_at as review_time, p.object_path as object_path
    from public.decisions d
    join public.incident_reports r on r.venue_id = d.venue_id and r.id = d.report_id
    left join public.incident_photos p on p.venue_id = d.venue_id and p.report_id = r.id
    where d.venue_id = p_venue_id and d.kind = 'ban' and d.lifted_at is null
      and (p_decision_id is null or d.id = p_decision_id)
      and (p_before_at is null or (d.decided_at, d.id) < (p_before_at, p_before_id))
      and (v_query = '' or strpos(lower(r.label), v_query) > 0 or strpos(lower(r.appearance), v_query) > 0)
    order by d.decided_at desc, d.id desc
    limit p_limit + 1
    )
    select b.*, (count(*) over () > p_limit)
    from batch b order by b.decision_time desc, b.ban_id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_teambrief_totals(uuid),
  public.find_active_bans(uuid, text, integer, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_teambrief_totals(uuid),
  public.find_active_bans(uuid, text, integer, timestamptz, uuid, uuid) to authenticated;
