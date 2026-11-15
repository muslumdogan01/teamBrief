-- TeamBrief: schema only. Apply to a new Supabase database using a trusted
-- migration role. No localStorage data or demo users are imported.
begin;

create schema if not exists teambrief_private;
revoke all on schema teambrief_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (display_name ~ '[^[:space:]]' and char_length(display_name) <= 100),
  created_at timestamptz not null default statement_timestamp()
);
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '[^[:space:]]' and char_length(name) <= 200),
  created_at timestamptz not null default statement_timestamp()
);
create table public.venue_memberships (
  venue_id uuid not null references public.venues(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('staff', 'manager')),
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  primary key (venue_id, user_id)
);
create index venue_memberships_user_idx on public.venue_memberships(user_id, venue_id) where is_active;

create table public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  reported_by uuid not null,
  label text not null check (label ~ '[^[:space:]]' and char_length(label) <= 100),
  occurred_at timestamptz not null,
  incident_type text not null check (incident_type in ('aggressive_behaviour', 'causing_disturbance', 'intoxication', 'rule_violation', 'other')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  appearance text not null check (appearance ~ '[^[:space:]]' and char_length(appearance) <= 2000),
  description text not null check (description ~ '[^[:space:]]' and char_length(description) <= 10000),
  -- Like the TS model, this is the original submission status. Review results
  -- and the pending queue are derived from the separate decisions table.
  status text not null default 'pending_review' check (status = 'pending_review'),
  created_at timestamptz not null default statement_timestamp(),
  unique (venue_id, id),
  foreign key (venue_id, reported_by) references public.venue_memberships(venue_id, user_id) on delete restrict,
  check (isfinite(occurred_at) and isfinite(created_at) and occurred_at <= created_at)
);
create index incident_reports_venue_created_idx on public.incident_reports(venue_id, created_at desc);
create index incident_reports_author_idx on public.incident_reports(reported_by, venue_id, created_at desc);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  report_id uuid not null unique,
  kind text not null check (kind in ('ban', 'no-ban')),
  explanation text not null check (explanation ~ '[^[:space:]]' and char_length(explanation) <= 10000),
  severity text check (severity in ('low', 'medium', 'high')),
  instruction text,
  review_at timestamptz,
  decided_by uuid not null,
  decided_at timestamptz not null default statement_timestamp(),
  lifted_by uuid,
  lifted_at timestamptz,
  lift_reason text,
  unique (venue_id, id),
  foreign key (venue_id, report_id) references public.incident_reports(venue_id, id) on delete restrict,
  foreign key (venue_id, decided_by) references public.venue_memberships(venue_id, user_id) on delete restrict,
  foreign key (venue_id, lifted_by) references public.venue_memberships(venue_id, user_id) on delete restrict,
  check (isfinite(decided_at)),
  check (
    (kind = 'ban' and severity is not null and instruction is not null
      and instruction ~ '[^[:space:]]' and char_length(instruction) <= 10000
      and review_at is not null and isfinite(review_at) and review_at > decided_at)
    or (kind = 'no-ban' and severity is null and instruction is null and review_at is null)
  ),
  check (
    (lifted_by is null and lifted_at is null and lift_reason is null)
    or (kind = 'ban' and lifted_by is not null and lifted_at is not null
      and isfinite(lifted_at) and lifted_at >= decided_at and lift_reason is not null
      and lift_reason ~ '[^[:space:]]' and char_length(lift_reason) <= 10000)
  )
);
-- Active means not explicitly lifted. review_at is deliberately NOT a filter.
create index decisions_active_idx on public.decisions(venue_id, decided_at desc) where kind = 'ban' and lifted_at is null;
create index decisions_review_idx on public.decisions(venue_id, review_at) where kind = 'ban' and lifted_at is null;
create index decisions_actor_idx on public.decisions(venue_id, decided_by);
create index decisions_lift_actor_idx on public.decisions(venue_id, lifted_by) where lifted_by is not null;

create table public.decision_history (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  decision_id uuid not null,
  event_type text not null check (event_type in ('created', 'lifted')),
  actor_id uuid not null,
  occurred_at timestamptz not null,
  reason text not null check (reason ~ '[^[:space:]]' and char_length(reason) <= 10000),
  foreign key (venue_id, decision_id) references public.decisions(venue_id, id) on delete restrict,
  foreign key (venue_id, actor_id) references public.venue_memberships(venue_id, user_id) on delete restrict,
  unique (decision_id, event_type),
  check (isfinite(occurred_at))
);
create index decision_history_venue_time_idx on public.decision_history(venue_id, occurred_at desc);
create index decision_history_actor_idx on public.decision_history(venue_id, actor_id);

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.venue_memberships enable row level security;
alter table public.incident_reports enable row level security;
alter table public.decisions enable row level security;
alter table public.decision_history enable row level security;

-- Helpers take a venue, never a caller-supplied user ID. They are outside the
-- exposed API schema, bypass RLS only for narrowly scoped membership checks,
-- and avoid recursive report/decision SELECT policies.
create function teambrief_private.is_member(p_venue_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.venue_memberships m
    where m.venue_id = p_venue_id and m.user_id = (select auth.uid()) and m.is_active);
$$;
create function teambrief_private.is_manager(p_venue_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.venue_memberships m
    where m.venue_id = p_venue_id and m.user_id = (select auth.uid()) and m.is_active and m.role = 'manager');
$$;
create function teambrief_private.owns_report(p_venue_id uuid, p_report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.incident_reports r
    where r.venue_id = p_venue_id and r.id = p_report_id and r.reported_by = (select auth.uid()));
$$;
create function teambrief_private.can_read_decision(p_venue_id uuid, p_decision_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select teambrief_private.is_member(p_venue_id) and exists (
    select 1 from public.decisions d where d.venue_id = p_venue_id and d.id = p_decision_id
      and (teambrief_private.is_manager(p_venue_id) or teambrief_private.owns_report(p_venue_id, d.report_id))
  );
$$;

create policy profiles_self_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy venues_member_select on public.venues for select to authenticated using (teambrief_private.is_member(id));
create policy memberships_self_select on public.venue_memberships for select to authenticated using (user_id = (select auth.uid()) and is_active);
create policy reports_author_or_manager_select on public.incident_reports for select to authenticated using (
  teambrief_private.is_member(venue_id) and (reported_by = (select auth.uid()) or teambrief_private.is_manager(venue_id))
);
create policy decisions_select on public.decisions for select to authenticated using (
  teambrief_private.is_member(venue_id) and (
    (kind = 'ban' and lifted_at is null) or teambrief_private.is_manager(venue_id) or teambrief_private.owns_report(venue_id, report_id)
  )
);
create policy history_select on public.decision_history for select to authenticated using (
  teambrief_private.can_read_decision(venue_id, decision_id)
);

-- Row lock serializes membership revocation/demotion with writes in flight.
create function teambrief_private.require_member(p_venue_id uuid, p_manager boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  perform 1 from public.venue_memberships m where m.venue_id = p_venue_id
    and m.user_id = v_user and m.is_active and (not p_manager or m.role = 'manager') for share;
  if not found then raise exception using errcode = '42501', message = 'Venue access denied'; end if;
  return v_user;
end;
$$;
create function teambrief_private.reject_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'This record is immutable';
end;
$$;
create trigger reports_immutable before update or delete on public.incident_reports
  for each row execute function teambrief_private.reject_change();
create trigger history_immutable before update or delete on public.decision_history
  for each row execute function teambrief_private.reject_change();
create trigger decisions_no_delete before delete on public.decisions
  for each row execute function teambrief_private.reject_change();

create function teambrief_private.stamp_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.reported_by := teambrief_private.require_member(new.venue_id);
  new.created_at := statement_timestamp();
  new.status := 'pending_review';
  return new;
end;
$$;
create trigger reports_stamp before insert on public.incident_reports
  for each row execute function teambrief_private.stamp_report();

create function teambrief_private.guard_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.decided_by := teambrief_private.require_member(new.venue_id, true);
    new.decided_at := statement_timestamp();
    if new.lifted_by is not null or new.lifted_at is not null or new.lift_reason is not null then
      raise exception using errcode = '23514', message = 'A new decision cannot already be lifted';
    end if;
  else
    if (to_jsonb(new) - array['lifted_by', 'lifted_at', 'lift_reason']) is distinct from
       (to_jsonb(old) - array['lifted_by', 'lifted_at', 'lift_reason']) then
      raise exception using errcode = '55000', message = 'The original decision is immutable';
    end if;
    if old.kind <> 'ban' or old.lifted_at is not null then
      raise exception using errcode = '55000', message = 'Only an active ban can be lifted';
    end if;
    new.lifted_by := teambrief_private.require_member(old.venue_id, true);
    new.lifted_at := statement_timestamp();
    if new.lift_reason is null or new.lift_reason !~ '[^[:space:]]' then
      raise exception using errcode = '23514', message = 'A reason for lifting the ban is required';
    end if;
  end if;
  return new;
end;
$$;
create trigger decisions_guard before insert or update on public.decisions
  for each row execute function teambrief_private.guard_decision();

-- Audit entries are generated atomically in the decision transaction, not by
-- the client. Failure to record history rolls back the decision/lift as well.
create function teambrief_private.record_decision_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.decision_history(venue_id, decision_id, event_type, actor_id, occurred_at, reason)
  values (new.venue_id, new.id, case when tg_op = 'INSERT' then 'created' else 'lifted' end,
    case when tg_op = 'INSERT' then new.decided_by else new.lifted_by end,
    case when tg_op = 'INSERT' then new.decided_at else new.lifted_at end,
    case when tg_op = 'INSERT' then new.explanation else new.lift_reason end);
  return new;
end;
$$;
create trigger decisions_audit after insert or update on public.decisions
  for each row execute function teambrief_private.record_decision_event();

-- Auth provisioning creates a profile only; never a membership or a role.
create function teambrief_private.create_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name) values (new.id, 'Team member');
  return new;
end;
$$;
create trigger teambrief_auth_profile after insert on auth.users
  for each row execute function teambrief_private.create_auth_profile();
insert into public.profiles(id, display_name) select id, 'Team member' from auth.users on conflict (id) do nothing;

create function public.create_incident_report(
  p_venue_id uuid, p_label text, p_occurred_at timestamptz, p_incident_type text,
  p_severity text, p_appearance text, p_description text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform teambrief_private.require_member(p_venue_id);
  insert into public.incident_reports(venue_id, label, occurred_at, incident_type, severity, appearance, description)
    values (p_venue_id, p_label, p_occurred_at, p_incident_type, p_severity, p_appearance, p_description)
    returning id into v_id;
  return v_id;
end;
$$;
create function public.create_decision(
  p_venue_id uuid, p_report_id uuid, p_kind text, p_explanation text,
  p_severity text default null, p_instruction text default null, p_review_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform teambrief_private.require_member(p_venue_id, true);
  -- Lock the original row: concurrent reviews cannot both decide this report.
  perform 1 from public.incident_reports where id = p_report_id and venue_id = p_venue_id for update;
  if not found then raise exception using errcode = '42501', message = 'Report not available in this venue'; end if;
  insert into public.decisions(venue_id, report_id, kind, explanation, severity, instruction, review_at)
    values (p_venue_id, p_report_id, p_kind, p_explanation, p_severity, p_instruction, p_review_at)
    returning id into v_id;
  return v_id;
end;
$$;
create function public.lift_service_ban(p_venue_id uuid, p_decision_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform teambrief_private.require_member(p_venue_id, true);
  update public.decisions set lift_reason = p_reason
    where venue_id = p_venue_id and id = p_decision_id and kind = 'ban' and lifted_at is null;
  if not found then raise exception using errcode = '55000', message = 'Active ban not found'; end if;
end;
$$;

-- Staff must not receive another employee's full incident description or
-- reporter identity. This explicit projection is the only cross-author read.
create function public.get_active_decision_incidents(p_venue_id uuid)
returns table (decision_id uuid, report_id uuid, venue_id uuid, label text,
  appearance text, incident_type text, occurred_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not teambrief_private.is_member(p_venue_id) then
    raise exception using errcode = '42501', message = 'Venue access denied';
  end if;
  return query select d.id, r.id, r.venue_id, r.label, r.appearance, r.incident_type, r.occurred_at
    from public.decisions d join public.incident_reports r on r.id = d.report_id and r.venue_id = d.venue_id
    where d.venue_id = p_venue_id and d.kind = 'ban' and d.lifted_at is null;
end;
$$;

-- No client DML, even if a future broad RLS policy is accidentally added.
-- All writes are RPC-only. Memberships/venues/profiles are trusted-admin only.
revoke all on table public.profiles, public.venues, public.venue_memberships,
  public.incident_reports, public.decisions, public.decision_history from public, anon, authenticated;
grant select on table public.profiles, public.venues, public.venue_memberships,
  public.incident_reports, public.decisions, public.decision_history to authenticated;
revoke all on all functions in schema teambrief_private from public, anon, authenticated;
grant usage on schema teambrief_private to authenticated;
grant execute on function teambrief_private.is_member(uuid), teambrief_private.is_manager(uuid),
  teambrief_private.owns_report(uuid, uuid), teambrief_private.can_read_decision(uuid, uuid) to authenticated;
revoke all on function public.create_incident_report(uuid, text, timestamptz, text, text, text, text),
  public.create_decision(uuid, uuid, text, text, text, text, timestamptz),
  public.lift_service_ban(uuid, uuid, text), public.get_active_decision_incidents(uuid) from public, anon, authenticated;
grant execute on function public.create_incident_report(uuid, text, timestamptz, text, text, text, text),
  public.create_decision(uuid, uuid, text, text, text, text, timestamptz),
  public.lift_service_ban(uuid, uuid, text), public.get_active_decision_incidents(uuid) to authenticated;

commit;
