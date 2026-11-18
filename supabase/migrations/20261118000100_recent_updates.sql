create table public.venue_updates (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  decision_id uuid not null unique,
  event_type text not null check (event_type = 'ban_lifted'),
  person_label text not null,
  service_note text not null check (service_note ~ '[^[:space:]]' and char_length(service_note) <= 10000),
  occurred_at timestamptz not null,
  foreign key (venue_id, decision_id) references public.decisions(venue_id, id) on delete restrict
);

create index venue_updates_recent_idx on public.venue_updates(venue_id, occurred_at desc, id desc);

create table public.venue_update_reads (
  update_id uuid not null references public.venue_updates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default statement_timestamp(),
  primary key (update_id, user_id)
);

alter table public.venue_updates enable row level security;
alter table public.venue_update_reads enable row level security;

revoke all on public.venue_updates, public.venue_update_reads from public, anon, authenticated;
grant select on public.venue_updates, public.venue_update_reads to authenticated;

create policy updates_active_member_select on public.venue_updates for select to authenticated
  using (teambrief_private.is_member(venue_id));

create policy update_reads_self_select on public.venue_update_reads for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.venue_updates u where u.id = update_id
  ));

drop function public.lift_service_ban(uuid, uuid, text);
create function public.lift_service_ban(
  p_venue_id uuid, p_decision_id uuid, p_reason text, p_service_note text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_decision public.decisions;
begin
  -- Serialize this lift against changes to the acting manager's membership.
  perform 1 from public.venue_memberships
    where venue_id = p_venue_id and user_id = (select auth.uid())
      and is_active and role = 'manager'
    for share;
  if not found then
    raise exception using errcode = '42501', message = 'Active manager membership required';
  end if;

  if p_service_note is null or p_service_note !~ '[^[:space:]]' or char_length(p_service_note) > 10000 then
    raise exception using errcode = '23514', message = 'A service note of up to 10000 characters is required';
  end if;

  update public.decisions set lift_reason = p_reason
    where venue_id = p_venue_id and id = p_decision_id and kind = 'ban' and lifted_at is null
    returning * into v_decision;
  if not found then raise exception using errcode = '55000', message = 'Active ban not found'; end if;

  insert into public.venue_updates (venue_id, decision_id, event_type, person_label, service_note, occurred_at)
    values (v_decision.venue_id, v_decision.id, 'ban_lifted', (
      select r.label from public.incident_reports r
        where r.venue_id = v_decision.venue_id and r.id = v_decision.report_id
    ), p_service_note, v_decision.lifted_at);
end;
$$;

create function public.get_recent_updates(p_venue_id uuid)
returns table (id uuid, event_type text, person_label text, service_note text, occurred_at timestamptz, read_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select u.id, u.event_type, u.person_label, u.service_note, u.occurred_at, r.read_at
    from public.venue_updates u
    left join public.venue_update_reads r on r.update_id = u.id and r.user_id = (select auth.uid())
    where u.venue_id = p_venue_id
    order by u.occurred_at desc, u.id desc
    limit 20;
$$;

create function public.mark_venue_update_read(p_venue_id uuid, p_update_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
begin
  v_user_id := teambrief_private.require_member(p_venue_id, false);
  if not exists (select 1 from public.venue_updates u where u.venue_id = p_venue_id and u.id = p_update_id) then
    raise exception using errcode = '42501', message = 'Update unavailable';
  end if;

  insert into public.venue_update_reads (update_id, user_id)
    values (p_update_id, v_user_id)
    on conflict (update_id, user_id) do nothing;
end;
$$;

revoke all on function public.lift_service_ban(uuid, uuid, text, text),
  public.get_recent_updates(uuid), public.mark_venue_update_read(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lift_service_ban(uuid, uuid, text, text),
  public.get_recent_updates(uuid), public.mark_venue_update_read(uuid, uuid) to authenticated;
