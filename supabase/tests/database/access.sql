-- Run ONLY against a disposable local Supabase database after the migration.
-- psql -X -v ON_ERROR_STOP=1 "$LOCAL_TEST_DATABASE_URL" -f supabase/tests/database/access.sql
-- Requires a trusted database owner. Fixtures and helpers are rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end $$;
create function pg_temp.denied(command text, expected_state text default '42501') returns void
language plpgsql as $$ begin
  begin
    execute command;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'FAIL: operation unexpectedly succeeded: %', command;
end $$;

insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000001'), -- A staff
 ('10000000-0000-0000-0000-000000000002'), -- A manager
 ('10000000-0000-0000-0000-000000000003'), -- B manager
 ('10000000-0000-0000-0000-000000000004'); -- A second staff (not the report author)
insert into public.venues(id, name) values
 ('20000000-0000-0000-0000-000000000001', 'Test pub A'),
 ('20000000-0000-0000-0000-000000000002', 'Test pub B');
select pg_temp.assert_true(not exists(select 1 from public.venue_memberships where user_id::text like '10000000-%'), 'signup never grants membership');
insert into public.venue_memberships(venue_id, user_id, role) values
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'staff'),
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'manager'),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'manager'),
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'staff');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select public.create_incident_report('20000000-0000-0000-0000-000000000002', 'B guest', now() - interval '1 day', 'other', 'low', 'B appearance', 'B private description') as b_report \gset
select public.create_decision('20000000-0000-0000-0000-000000000002', :'b_report', 'ban', 'B reason', 'low', 'Do not serve', now() + interval '1 day') as b_decision \gset

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(not exists(select 1 from public.venues where name = 'Test pub B'), 'cross-pub venue hidden');
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'b_report'), 'cross-pub report hidden');
select pg_temp.assert_true(not exists(select 1 from public.decisions where id = :'b_decision'), 'cross-pub decision hidden');
select pg_temp.assert_true(not exists(select 1 from public.decision_history where decision_id = :'b_decision'), 'cross-pub history hidden');
select pg_temp.denied($q$update public.venue_memberships set role = 'manager' where user_id = auth.uid()$q$);
select pg_temp.denied($q$insert into public.venue_memberships(venue_id, user_id, role) values ('20000000-0000-0000-0000-000000000002', auth.uid(), 'manager')$q$);
select pg_temp.denied($q$select public.create_incident_report('20000000-0000-0000-0000-000000000002', 'x', now(), 'other', 'low', 'x', 'x')$q$);
select pg_temp.denied($q$select * from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000002')$q$);
select public.create_incident_report('20000000-0000-0000-0000-000000000001', 'A guest', now() - interval '1 day', 'other', 'low', 'A appearance', 'A private description') as a_report \gset
select pg_temp.assert_true(exists(select 1 from public.incident_reports where id = :'a_report' and description = 'A private description' and reported_by = auth.uid()), 'author can read original full report');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'a_report'), 'other staff cannot read pending full report');
select pg_temp.assert_true(not exists(select 1 from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001') where report_id = :'a_report'), 'pending report has no active summary');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_report', 'no-ban', 'Staff cannot decide'));
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000002', :'b_decision', 'Staff cannot lift', 'Team service note'));
select pg_temp.denied($q$delete from public.incident_reports$q$);
select pg_temp.denied($q$insert into public.decision_history(venue_id) values ('20000000-0000-0000-0000-000000000001')$q$);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(exists(select 1 from public.incident_reports where id = :'a_report'), 'manager sees own pub report');
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'b_report'), 'manager cannot read another pub');
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000002', :'b_report', 'no-ban', 'Wrong pub'));
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'b_report', 'no-ban', 'Mismatched report'));
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000002', :'b_decision', 'Wrong pub', 'Team service note'));
-- Invalid attempts must leave this report undecided, so the valid attempt below
-- also proves that a failed constraint check does not consume the report.
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_report', 'ban', '   ', 'low', 'Do not serve', now() + interval '1 day'), '23514');
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_report', 'ban', 'Reason', 'low', null, now() + interval '1 day'), '23514');
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_report', 'ban', 'Reason', 'low', '   ', now() + interval '1 day'), '23514');
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_report', 'ban', 'Reason', 'low', 'Do not serve', now() - interval '1 day'), '23514');
select pg_temp.assert_true(not exists(select 1 from public.decisions where report_id = :'a_report'), 'invalid bans leave no decision');
select public.create_decision('20000000-0000-0000-0000-000000000001', :'a_report', 'ban', 'A reason', 'low', 'Do not serve', now() + interval '1 day') as a_decision \gset
select pg_temp.assert_true((select count(*) = 1 from public.decision_history where decision_id = :'a_decision' and event_type = 'created'), 'creation audited');
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_report', 'no-ban', 'Duplicate'), '23505');
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', '   ', 'Team service note'), '23514');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', 'Staff cannot lift own pub ban', 'Team service note'));
select pg_temp.assert_true(exists(select 1 from public.decisions where id = :'a_decision'), 'staff sees active ban');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
-- Same pub, different staff: only the active decision and explicit person summary.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'a_report'), 'other staff cannot read full report even while ban active');
select pg_temp.assert_true(exists(select 1 from public.decisions where id = :'a_decision' and instruction = 'Do not serve' and lifted_at is null), 'other staff sees active service instructions');
select pg_temp.assert_true((select count(*) = 1 from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001') r where r.decision_id = :'a_decision' and r.report_id = :'a_report' and r.label = 'A guest' and r.appearance = 'A appearance'), 'other staff sees identifying summary');
-- Exact JSON key allowlist catches any newly leaked column, not just known names.
select pg_temp.assert_true((select array_agg(keys.key order by keys.key) = array['appearance', 'decision_id', 'incident_type', 'label', 'occurred_at', 'report_id', 'venue_id']::text[] from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001') r cross join lateral jsonb_object_keys(to_jsonb(r)) as keys(key) where r.decision_id = :'a_decision'), 'summary excludes description and reporter identity');
select pg_temp.assert_true(not exists(select 1 from public.decision_history where decision_id = :'a_decision'), 'other staff cannot read audit history');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 1 from public.decision_history where decision_id = :'a_decision' and event_type = 'created' and reason = 'A reason'), 'author sees creation history');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
-- Force the update insert to fail after the decision and audit writes.
reset role;
create function pg_temp.reject_update_insert() returns trigger language plpgsql as $$
begin
  if new.service_note = 'Force rollback' then
    raise exception using errcode = '23514', message = 'Simulated update insert failure';
  end if;
  return new;
end;
$$;
create trigger test_reject_update before insert on public.venue_updates
  for each row execute function pg_temp.reject_update_insert();
set local role authenticated;
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', 'Reviewed', 'Force rollback'), '23514');
select pg_temp.assert_true((select lifted_at is null from public.decisions where id = :'a_decision'), 'failed update insert rolls back lift');
select pg_temp.assert_true((select count(*) = 1 from public.decision_history where decision_id = :'a_decision'), 'failed update insert rolls back lift history');
select pg_temp.assert_true(not exists(select 1 from public.venue_updates where decision_id = :'a_decision'), 'failed lift leaves no update');
select public.lift_service_ban('20000000-0000-0000-0000-000000000001', :'a_decision', 'Reviewed', 'Team service note');
select id as a_update from public.venue_updates where decision_id = :'a_decision' \gset
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(not exists(select 1 from public.venue_updates where id = :'a_update'), 'other pub cannot see update');
select pg_temp.denied(format('select public.mark_venue_update_read(%L, %L)', '20000000-0000-0000-0000-000000000002', :'a_update'));
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true((select count(*) = 2 from public.decision_history where decision_id = :'a_decision'), 'lift audited and creation preserved');
select pg_temp.assert_true((select lifted_by = auth.uid() and lift_reason = 'Reviewed' from public.decisions where id = :'a_decision'), 'server stamps lifting manager');
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', 'Again', 'Team service note'), '55000');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(not exists(select 1 from public.decisions where id = :'a_decision'), 'other staff loses decision access after lift');
select pg_temp.assert_true((select event_type = 'ban_lifted' and person_label = 'A guest' and service_note = 'Team service note' and read_at is null from public.get_recent_updates('20000000-0000-0000-0000-000000000001') where id = :'a_update'), 'other staff sees unread public update');
select pg_temp.denied('delete from public.venue_updates');
select pg_temp.denied('delete from public.venue_update_reads');
select public.mark_venue_update_read('20000000-0000-0000-0000-000000000001', :'a_update');
select read_at as first_read from public.venue_update_reads where update_id = :'a_update' \gset
select public.mark_venue_update_read('20000000-0000-0000-0000-000000000001', :'a_update');
select pg_temp.assert_true((select read_at = :'first_read'::timestamptz from public.venue_update_reads where update_id = :'a_update'), 'mark read preserves original timestamp');

select pg_temp.assert_true(not exists(select 1 from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001') where decision_id = :'a_decision'), 'lifted person summary disappears');
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'a_report'), 'full report stays private after lift');
select pg_temp.assert_true(not exists(select 1 from public.decision_history where decision_id = :'a_decision'), 'lift history stays private from other staff');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 2 from public.decision_history where decision_id = :'a_decision'), 'author retains both history events after lift');
select pg_temp.assert_true((select read_at is null from public.get_recent_updates('20000000-0000-0000-0000-000000000001') where id = :'a_update'), 'author has independent unread state');
select pg_temp.assert_true(not exists(select 1 from public.venue_update_reads where update_id = :'a_update'), 'other users cannot see read receipts');

select pg_temp.assert_true(exists(select 1 from public.decision_history where decision_id = :'a_decision' and event_type = 'lifted' and reason = 'Reviewed'), 'author sees lifting reason');
select pg_temp.assert_true(exists(select 1 from public.decisions where id = :'a_decision' and lifted_at is not null), 'author retains lifted decision');

-- Deterministic overdue fixture: emulate a decision made two days ago.
-- Only the trusted test owner disables the timestamp guard for this insertion.
-- All constraints and audit triggers remain active. No sleep or client bypass.
select public.create_incident_report('20000000-0000-0000-0000-000000000001', 'Overdue guest', now() - interval '3 days', 'other', 'low', 'Overdue appearance', 'Overdue private description') as overdue_report \gset
reset role;
alter table public.decisions disable trigger decisions_guard;
insert into public.decisions(venue_id, report_id, kind, explanation, severity, instruction, review_at, decided_by, decided_at)
values ('20000000-0000-0000-0000-000000000001', :'overdue_report', 'ban', 'Historical reason', 'low', 'Still do not serve', now() - interval '1 day', '10000000-0000-0000-0000-000000000002', now() - interval '2 days')
returning id as overdue_decision \gset
alter table public.decisions enable trigger decisions_guard;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(exists(select 1 from public.decisions where id = :'overdue_decision' and review_at < statement_timestamp() and lifted_at is null), 'overdue ban remains active and visible to other staff');
select pg_temp.assert_true(exists(select 1 from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001') where decision_id = :'overdue_decision' and appearance = 'Overdue appearance'), 'overdue ban remains in active summary RPC');
-- Use one statement for all new decisions so timestamp ties span the page boundary.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$
declare
  venue uuid := '20000000-0000-0000-0000-000000000001';
  report uuid;
begin
  for n in 1..23 loop
    report := public.create_incident_report(venue, 'Directory guest ' || n, now() - interval '5 days',
      'other', 'low', 'Imaginary blue jacket', 'Private directory fixture');
    perform public.create_decision(venue, report, 'ban', 'Private decision fixture', 'low',
      'Do not serve', now() + interval '1 day');
  end loop;
  perform public.create_incident_report(venue, 'Unreviewed directory guest', now() - interval '1 day',
    'other', 'low', 'Imaginary scarf', 'Private new report');
end;
$$;
select pg_temp.assert_true((select active_bans = 24 and my_incidents = 24 and awaiting_review = 1
  from public.get_teambrief_totals('20000000-0000-0000-0000-000000000001')), 'manager totals use full data and only count undecided reports for review');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true((select active_bans = 24 and my_incidents = 0 and awaiting_review is null
  from public.get_teambrief_totals('20000000-0000-0000-0000-000000000001')), 'staff totals are exact and hide manager review count');
select pg_temp.assert_true((select count(*) = 20 and bool_and(has_more) and bool_and(decision_id <> :'overdue_decision')
  from public.find_active_bans('20000000-0000-0000-0000-000000000001')), 'first page contains 20 newer decisions regardless of incident date');
select pg_temp.assert_true((select count(*) = 5 and bool_and(has_more)
  from public.find_active_bans('20000000-0000-0000-0000-000000000001', '', 5)), 'mobile receives only five');
select pg_temp.assert_true((select count(*) = 1 and bool_and(decision_id = :'overdue_decision')
  from public.find_active_bans('20000000-0000-0000-0000-000000000001', '  OVERDUE appearance  ')), 'search finds physical description beyond the first page');
select pg_temp.assert_true((select count(*) = 1 and bool_and(decision_id = :'overdue_decision')
  from public.find_active_bans('20000000-0000-0000-0000-000000000001', 'Overdue guest')), 'search finds person label beyond the first page');
select pg_temp.assert_true(not exists(select 1 from public.find_active_bans('20000000-0000-0000-0000-000000000001', '%')), 'wildcards are literal');
select pg_temp.assert_true(not exists(select 1 from public.find_active_bans('20000000-0000-0000-0000-000000000001', 'A guest')), 'lifted ban excluded from search');
select pg_temp.assert_true(not exists(select 1 from public.find_active_bans('20000000-0000-0000-0000-000000000001', p_decision_id => :'a_decision')), 'lifted ban excluded from direct detail');
select pg_temp.assert_true((select count(*) = 20 and bool_and(has_more)
  from public.find_active_bans('20000000-0000-0000-0000-000000000001', 'blue jacket')), 'search paginates within matches');
with first_page as (
  select * from public.find_active_bans('20000000-0000-0000-0000-000000000001')
), boundary as (
  select decided_at, decision_id from first_page order by decided_at, decision_id limit 1
), second_page as (
  select b.* from boundary c cross join lateral public.find_active_bans(
    '20000000-0000-0000-0000-000000000001', '', 20, c.decided_at, c.decision_id) b
), both_pages as (
  select * from first_page union all select * from second_page
)
select pg_temp.assert_true(
  (select count(*) = 4 and not bool_or(has_more) from second_page) and
  (select count(*) = 24 and count(distinct decision_id) = 24 from both_pages),
  'timestamp ties use the UUID cursor without duplicates or omissions');
select pg_temp.denied($q$select * from public.find_active_bans('20000000-0000-0000-0000-000000000001', '', 21)$q$, '22023');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.denied($q$select * from public.find_active_bans('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied($q$select * from public.get_teambrief_totals('20000000-0000-0000-0000-000000000001')$q$);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);

-- Keep the original update older than a tied batch so it is searchable beyond page one.
reset role;
update public.venue_updates set occurred_at = now() - interval '1 day' where id = :'a_update';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$
declare
  venue uuid := '20000000-0000-0000-0000-000000000001';
  ban uuid;
begin
  for ban in
    select d.id from public.decisions d
    join public.incident_reports r on r.id = d.report_id
    where d.venue_id = venue and r.label like 'Directory guest %'
  loop
    perform public.lift_service_ban(venue, ban, 'Private fixture reason', 'Historical service note');
  end loop;
end;
$$;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true((select count(*) = 5 and bool_and(has_more) and bool_and(id <> :'a_update')
  from public.find_lift_updates('20000000-0000-0000-0000-000000000001', '', 5)), 'recent updates contain the five newest records');
with first_page as (
  select * from public.find_lift_updates('20000000-0000-0000-0000-000000000001')
), boundary as (
  select occurred_at, id from first_page order by occurred_at, id limit 1
), second_page as (
  select u.* from boundary b cross join lateral public.find_lift_updates(
    '20000000-0000-0000-0000-000000000001', '', 20, b.occurred_at, b.id) u
), combined as (
  select * from first_page union all select * from second_page
)
select pg_temp.assert_true(
  (select count(*) = 20 and bool_and(has_more) and bool_and(id <> :'a_update') from first_page)
  and (select count(*) = 4 and not bool_or(has_more) and bool_or(id = :'a_update') from second_page)
  and (select count(distinct id) = 24 from combined),
  'updates paginate across timestamp ties without omissions or duplicates');
select pg_temp.assert_true((select count(*) = 1 and bool_and(id = :'a_update' and read_at is not null and photo_path is null)
  from public.find_lift_updates('20000000-0000-0000-0000-000000000001', 'a guest')), 'older update is searchable and retains its receipt');
select pg_temp.assert_true((select count(*) = 1 and bool_and(id = :'a_update')
  from public.find_lift_updates('20000000-0000-0000-0000-000000000001', '  A APPEARANCE  ')),
  'physical description search finds an update beyond the first page');
select pg_temp.assert_true(not exists(select 1
  from public.find_lift_updates('20000000-0000-0000-0000-000000000001', 'unlikely search phrase')),
  'unmatched search does not return the unfiltered feed');
select pg_temp.assert_true((select count(*) = 20 and bool_and(has_more)
  from public.find_lift_updates('20000000-0000-0000-0000-000000000001', '  IMAGINARY BLUE jacket  ')), 'search uses physical description across pages');
select pg_temp.assert_true(not exists (select 1
  from public.find_lift_updates('20000000-0000-0000-0000-000000000001', 'Private fixture reason')), 'search excludes private lift reasons');
select pg_temp.assert_true(public.count_unread_lift_updates('20000000-0000-0000-0000-000000000001') = 23,
  'unread count covers the full pub and honors an existing receipt');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(public.count_unread_lift_updates('20000000-0000-0000-0000-000000000001') = 24,
  'another account retains an independent unread count');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.denied($q$select * from public.find_lift_updates('20000000-0000-0000-0000-000000000001')$q$);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);

reset role;
update public.venue_memberships set is_active = false where user_id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.decisions where id = :'overdue_decision'), 'inactive other staff cannot see still-active ban');
select pg_temp.denied($q$select * from public.find_active_bans('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied($q$select * from public.get_teambrief_totals('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied($q$select * from public.find_lift_updates('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.assert_true(not exists(select 1 from public.venue_updates where id = :'a_update'), 'inactive user loses update access');
select pg_temp.assert_true(not exists(select 1 from public.venue_update_reads where update_id = :'a_update'), 'inactive user loses receipt access');
select pg_temp.denied(format('select public.mark_venue_update_read(%L, %L)', '20000000-0000-0000-0000-000000000001', :'a_update'));

select pg_temp.denied($q$select * from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001')$q$);

reset role;
update public.venue_memberships set is_active = false where user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'a_report'), 'inactive member loses report access');
select pg_temp.denied($q$select public.create_incident_report('20000000-0000-0000-0000-000000000001', 'x', now(), 'other', 'low', 'x', 'x')$q$);
select pg_temp.assert_true(not exists(select 1 from public.decisions where id = :'overdue_decision'), 'inactive author cannot see active ban');
select pg_temp.assert_true(not exists(select 1 from public.decision_history where decision_id = :'overdue_decision'), 'inactive author loses history access');
select pg_temp.denied($q$select * from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001')$q$);
-- A missing upload must roll back report, metadata and reservation finalization.
reset role;
select pg_temp.assert_true((select not public and file_size_limit = 5000000
  and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  from storage.buckets where id = 'incident-photos'), 'private photo bucket enforces MIME and 5 MB cap');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select gen_random_uuid() as photo_report, gen_random_uuid() as photo_upload \gset
select object_path as staged_photo from public.prepare_incident_photo('20000000-0000-0000-0000-000000000001', :'photo_report', :'photo_upload') \gset
select pg_temp.denied(format('select public.submit_incident_report(%L,%L,%L,now(),%L,%L,%L,%L,%L)',
  '20000000-0000-0000-0000-000000000001', :'photo_report', 'Photo fixture', 'other', 'low', 'Fixture appearance', 'Fixture private description', :'staged_photo'), '23514');
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'photo_report'), 'missing photo cannot create the incident');
select pg_temp.assert_true(not exists(select 1 from public.incident_photos where report_id = :'photo_report'), 'missing photo cannot create attachment metadata');
select pg_temp.denied(format('insert into public.incident_photos(report_id, venue_id, object_path) values (%L,%L,%L)',
  :'photo_report', '20000000-0000-0000-0000-000000000001', :'staged_photo'));
select pg_temp.assert_true((select object_path = :'staged_photo' and not uploaded from public.prepare_incident_photo('20000000-0000-0000-0000-000000000001', :'photo_report', :'photo_upload')), 'failed finalization can recover the same reservation');
select public.abandon_incident_photo('20000000-0000-0000-0000-000000000001', :'photo_report', :'photo_upload');
select pg_temp.denied(format('select * from public.prepare_incident_photo(%L,%L,%L)',
  '20000000-0000-0000-0000-000000000001', :'photo_report', :'photo_upload'), '55000');

-- Clear identity as well as changing SQL role, like a genuinely anonymous call.
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.denied($q$select * from public.find_active_bans('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied($q$select * from public.get_teambrief_totals('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied('select * from public.profiles');
select pg_temp.denied('select * from public.venues');
select pg_temp.denied('select * from public.venue_memberships');
select pg_temp.denied('select * from public.incident_reports');
select pg_temp.denied('select * from public.decisions');
select pg_temp.denied('select * from public.decision_history');
select pg_temp.denied('select * from public.venue_updates');
select pg_temp.denied('select * from public.venue_update_reads');
select pg_temp.denied('select * from public.incident_photos');
select pg_temp.denied(format('select * from public.prepare_incident_photo(%L,%L,%L)',
  '20000000-0000-0000-0000-000000000001', :'photo_report', :'photo_upload'));
select pg_temp.denied($q$select * from public.find_lift_updates('20000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied(format('select public.get_recent_updates(%L)', '20000000-0000-0000-0000-000000000001'));
select pg_temp.denied(format('select public.mark_venue_update_read(%L, %L)', '20000000-0000-0000-0000-000000000001', :'a_update'));
select pg_temp.denied($q$select public.create_incident_report('20000000-0000-0000-0000-000000000001', 'x', now(), 'other', 'low', 'x', 'x')$q$);
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'overdue_report', 'no-ban', 'Anonymous'));
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'overdue_decision', 'Anonymous', 'Team service note'));
select pg_temp.denied($q$select * from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001')$q$);
reset role;
rollback;
\echo 'Access checks passed; fixtures rolled back.'
