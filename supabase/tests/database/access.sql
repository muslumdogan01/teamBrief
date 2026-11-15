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
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L)', '20000000-0000-0000-0000-000000000002', :'b_decision', 'Staff cannot lift'));
select pg_temp.denied($q$delete from public.incident_reports$q$);
select pg_temp.denied($q$insert into public.decision_history(venue_id) values ('20000000-0000-0000-0000-000000000001')$q$);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true(exists(select 1 from public.incident_reports where id = :'a_report'), 'manager sees own pub report');
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'b_report'), 'manager cannot read another pub');
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000002', :'b_report', 'no-ban', 'Wrong pub'));
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'b_report', 'no-ban', 'Mismatched report'));
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L)', '20000000-0000-0000-0000-000000000002', :'b_decision', 'Wrong pub'));
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
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', '   '), '23514');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', 'Staff cannot lift own pub ban'));
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
select public.lift_service_ban('20000000-0000-0000-0000-000000000001', :'a_decision', 'Reviewed');
select pg_temp.assert_true((select count(*) = 2 from public.decision_history where decision_id = :'a_decision'), 'lift audited and creation preserved');
select pg_temp.assert_true((select lifted_by = auth.uid() and lift_reason = 'Reviewed' from public.decisions where id = :'a_decision'), 'server stamps lifting manager');
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'a_decision', 'Again'), '55000');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(not exists(select 1 from public.decisions where id = :'a_decision'), 'other staff loses decision access after lift');
select pg_temp.assert_true(not exists(select 1 from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001') where decision_id = :'a_decision'), 'lifted person summary disappears');
select pg_temp.assert_true(not exists(select 1 from public.incident_reports where id = :'a_report'), 'full report stays private after lift');
select pg_temp.assert_true(not exists(select 1 from public.decision_history where decision_id = :'a_decision'), 'lift history stays private from other staff');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true((select count(*) = 2 from public.decision_history where decision_id = :'a_decision'), 'author retains both history events after lift');
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
reset role;
update public.venue_memberships set is_active = false where user_id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.decisions where id = :'overdue_decision'), 'inactive other staff cannot see still-active ban');
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
-- Clear identity as well as changing SQL role, like a genuinely anonymous call.
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.denied('select * from public.profiles');
select pg_temp.denied('select * from public.venues');
select pg_temp.denied('select * from public.venue_memberships');
select pg_temp.denied('select * from public.incident_reports');
select pg_temp.denied('select * from public.decisions');
select pg_temp.denied('select * from public.decision_history');
select pg_temp.denied($q$select public.create_incident_report('20000000-0000-0000-0000-000000000001', 'x', now(), 'other', 'low', 'x', 'x')$q$);
select pg_temp.denied(format('select public.create_decision(%L, %L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'overdue_report', 'no-ban', 'Anonymous'));
select pg_temp.denied(format('select public.lift_service_ban(%L, %L, %L)', '20000000-0000-0000-0000-000000000001', :'overdue_decision', 'Anonymous'));
select pg_temp.denied($q$select * from public.get_active_decision_incidents('20000000-0000-0000-0000-000000000001')$q$);
reset role;
rollback;
\echo 'Access checks passed; fixtures rolled back.'
