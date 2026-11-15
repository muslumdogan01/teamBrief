# Supabase preparation review

Verified locally on 15 November 2026. The frontend remains a localStorage demo; no frontend connection was added and no browser records were read or changed. No cloud project was linked or accessed.

## Files and verification status

- `migrations/20261113000100_teambrief_schema.sql`: applied successfully by local Supabase startup; migration table contains `20261113000100` and all six application tables exist.
- `tests/database/access.sql`: executed **unchanged** with container `psql -X -v ON_ERROR_STOP=1`; exit code 0, 34 positive assertions and 32 expected-denial checks passed (66 total). Output ended with `ROLLBACK` and `Access checks passed; fixtures rolled back.`
- `config.toml`: generated local configuration, project ID `teambrief`, PostgreSQL major version 17. Migrations/tests were preserved. Seeding is disabled because the project has no seed file.
- `.gitignore`: generated Supabase ignore rules for transient/local files.

Environment: Node v22.19.0; Docker Client/Server 29.9.3; Supabase CLI 3.1.0 installed as a project devDependency. No containers or volumes existed before startup; no reset was used. Container `psql` provides the PostgreSQL client without a host installation.

Post-test database checks confirmed zero fixture auth users, zero rows across all six application tables, RLS enabled on all six tables, and `decisions_guard` enabled. The frontend suite passed 14/14 and `npm run build` passed. A post-test diagnostic query initially needed an explicit PostgreSQL `char` to `text` cast; the corrected diagnostic passed. This was not a migration or access-test failure.

## Repeat local execution

Run from the project root with Docker Desktop running. On this machine Docker binaries are under `/Applications/Docker.app/Contents/Resources/bin`; add that directory to PATH if necessary.

```sh
npx --no-install supabase start --exclude realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
docker exec -i supabase_db_teambrief psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/database/access.sql
```

Startup applies pending migrations when initializing the new local database. For an existing database, inspect migration state and data before applying any further migration; do not reset existing data. The tests require the trusted local owner to insert fixture auth users, switch roles and set up historical data. They roll back fixtures and helpers, and unexpected failures stop execution. Do not run them on a live project. Startup may display local credentials: keep that output private. Local services were left running after verification; `npx --no-install supabase stop` stops this project while retaining its data (do not use `--no-backup`).

## TypeScript mapping

| Demo TypeScript | SQL | Notes |
| --- | --- | --- |
| No pub model | `venues`, `venue_memberships` | Active membership scopes every pub read/write. |
| `employee` / `manager` | `staff` / `manager` | Explicit role mapping needed when connecting. No demo selector may grant a server role. |
| Fixed `Müslüm` / `Alex` names | `profiles`, actor UUIDs linked to memberships | Authentication identity replaces fixed names; profile SELECT currently exposes only the caller's profile. Manager-name display for other actors needs a deliberately scoped API later. |
| `Report`, camelCase fields | `incident_reports`, snake_case fields | Required text, past incident time, original `pending_review` status; author/time stamped by server. |
| `Decision` union | `decisions` with `kind` constraints | One decision per report; ban requires severity, instructions and future review time; no-ban fields must be NULL. |
| Optional nested `lifted` | `lifted_by`, `lifted_at`, `lift_reason` | Manager-only, reason required, one lift; original decision immutable. |
| Decision/lift fields in one object | `decision_history` | Server adds `created`/`lifted` events atomically; clients cannot edit history. |
| Active when no `lifted` | `kind = 'ban' AND lifted_at IS NULL` | Review time never automatically lifts a ban. |

Incident types match exactly: `aggressive_behaviour`, `causing_disturbance`, `intoxication`, `rule_violation`, `other`. Severity is `low`/`medium`/`high`; status is `pending_review`; decision kinds are `ban`/`no-ban`. SQL history adds `created`/`lifted` codes. No enum translation is needed except the explicit employee/staff role mapping.

SQL enforces field length limits matching the UI (label 100, appearance 2000, description/reasons/instructions 10000); TypeScript validation functions alone do not enforce these limits. SQL also requires lift time >= decision time, unlike the current TypeScript parser. SQL UUIDs, venue IDs and authenticated actors require an adapter; existing demo objects cannot be inserted unchanged. No automatic localStorage import is provided.

## Access review (source-level conclusions)

All six tables enable RLS. Client table grants are SELECT-only; writes go through explicitly granted security-definer RPCs with empty search paths and fully qualified table names. Anonymous clients have no table/RPC grants. Service-role and database-owner credentials bypass this client boundary and must remain trusted.

- **Other pubs:** every report/decision/history SELECT requires active membership in that pub. RPCs check the requested pub; composite foreign keys prevent a decision from linking to another pub's report. A manager in A is not a manager in B unless separately assigned there.
- **Self-promotion:** no client INSERT/UPDATE/DELETE grant or write policy exists for memberships. Auth signup creates only a profile; metadata does not assign roles. Role provisioning and changes require trusted administration.
- **Staff manager actions:** creating decisions and lifting bans both require an active manager membership, checked by RPC and trigger. Staff can submit reports but cannot create or lift decisions. Actors and timestamps are assigned server-side.
- **Privacy within a pub:** staff read their own full reports; managers read their pub's full reports. All active members see active decisions. Cross-author identifying report fields are available only through `get_active_decision_incidents`, which excludes description and reporter identity. History is restricted to managers and the report author. The frontend currently uses fuller demo objects, so this projection needs deliberate integration later.
- **History:** original reports and history reject updates/deletes; decisions reject deletion and changes beyond the single lifting transition. Audit insertion happens in the same transaction.

No concrete cross-pub/self-promotion/staff-escalation defect was identified in the source review; the corresponding SQL checks also passed against the local database. These checks exercise PostgreSQL roles and RLS directly, not the HTTP/JWT authentication layer. RLS is not forced for table owners, which permits the narrowly scoped security-definer helpers to check membership without recursive policies; owner/service credentials are outside the untrusted client threat model.

## Access test scope and remaining checks

The SQL file preserves the existing cross-pub, self-promotion, staff decision/lift denial, direct-write denial, manager success, duplicate-decision and lifting checks. It additionally covers:

- Two staff in pub A: only the author can read the full original report, before and after review.
- The other staff can read an active ban and its service instructions, plus the identifying summary RPC. An exact JSON key allowlist checks that the RPC exposes neither the incident description nor reporter identity (and catches any extra columns).
- After lifting, the other staff loses both decision and summary access; author and manager retain decision history, including creation and lifting events.
- Inactive author and inactive non-author cannot read a still-active ban or use the summary RPC.
- Anonymous clients are denied SELECT on all six application tables and execution of all four public application RPCs, with auth identity cleared.
- Blank ban reason, NULL/blank instructions and past review time fail constraint checks and leave no decision behind.
- A review-overdue ban remains visible as active in the decisions table and summary RPC.

Assertions run under `authenticated`/`anon` with test auth identities; setup uses a trusted role. The overdue fixture emulates a historical decision without waiting: the owner briefly disables only `decisions_guard` for one historical INSERT, then immediately re-enables it. CHECK constraints and the audit trigger remain active; this setup and all fixtures are inside the rollback transaction. This does not test client creation of a past-dated ban (which is separately required to fail).

The local environment is now operational; migration and access-test database execution are complete. No migration or access-test edits, security relaxations or expectation changes were required for the successful run.

Still pending: exercise manager demotion and concurrent revocation/decision races; verify exposed RPC permissions through the actual Supabase API/JWT layer. These are outside the direct psql checks reported here.
