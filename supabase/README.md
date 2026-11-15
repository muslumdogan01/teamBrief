# Supabase preparation review

Verified locally on 15 November 2026. The frontend now connects only to the running local Supabase stack with real email/password sessions. Existing browser demo records are untouched. No cloud project was linked or accessed; the existing migration was not reapplied or reset for this connection work.

## Files and verification status

- `migrations/20261113000100_teambrief_schema.sql`: applied successfully by local Supabase startup; migration table contains `20261113000100` and all six application tables exist.
- `tests/database/access.sql`: executed **unchanged** with container `psql -X -v ON_ERROR_STOP=1`; exit code 0, 34 positive assertions and 32 expected-denial checks passed (66 total). Output ended with `ROLLBACK` and `Access checks passed; fixtures rolled back.`
- `config.toml`: generated local configuration, project ID `teambrief`, PostgreSQL major version 17. Migrations/tests were preserved. Seeding is disabled because the project has no seed file.
- `.gitignore`: generated Supabase ignore rules for transient/local files.

Environment: Node v22.19.0; Docker Client/Server 29.9.3; Supabase CLI 3.1.0 installed as a project devDependency. No containers or volumes existed before startup; no reset was used. Container `psql` provides the PostgreSQL client without a host installation.

At the initial schema checkpoint, post-test database checks confirmed zero fixture auth users, zero application rows, RLS enabled on all six tables, and `decisions_guard` enabled. The database now intentionally contains three fictional local accounts, their pub memberships and retained fictional HTTP test reports/history. At the initial schema checkpoint, the frontend suite passed 14/14 and `npm run build` passed. After frontend connection, all 19 tests and the production build passed; all 66 SQL checks were rerun successfully without resetting the existing database. A post-test diagnostic query initially needed an explicit PostgreSQL `char` to `text` cast; the corrected diagnostic passed. This was not a migration or access-test failure.

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
| `employee` / `manager` | `staff` / `manager` | Mapped by `src/backend.ts`. No demo selector may grant a server role. |
| Fixed `Müslüm` / `Alex` names | `profiles`, actor UUIDs linked to memberships | Authentication identity replaces fixed names; profile SELECT currently exposes only the caller's profile. Connected screens display other actors as account UUIDs; no profile policy was expanded. |
| `Report`, camelCase fields | `incident_reports`, snake_case fields | Required text, past incident time, original `pending_review` status; author/time stamped by server. |
| `Decision` union | `decisions` with `kind` constraints | One decision per report; ban requires severity, instructions and future review time; no-ban fields must be NULL. |
| Optional nested `lifted` | `lifted_by`, `lifted_at`, `lift_reason` | Manager-only, reason required, one lift; original decision immutable. |
| Decision/lift fields in one object | `decision_history` | Server adds `created`/`lifted` events atomically; clients cannot edit history. |
| Active when no `lifted` | `kind = 'ban' AND lifted_at IS NULL` | Review time never automatically lifts a ban. |

Incident types match exactly: `aggressive_behaviour`, `causing_disturbance`, `intoxication`, `rule_violation`, `other`. Severity is `low`/`medium`/`high`; status is `pending_review`; decision kinds are `ban`/`no-ban`. SQL history adds `created`/`lifted` codes. No enum translation is needed except the explicit employee/staff role mapping.

SQL enforces field length limits matching the UI (label 100, appearance 2000, description/reasons/instructions 10000); TypeScript validation functions alone do not enforce these limits. SQL also requires lift time >= decision time, unlike the current TypeScript parser. The separate `src/backend.ts` adapter handles SQL UUIDs, venue IDs, actors and field names; existing demo objects are not inserted. No automatic localStorage import is provided.

## Access review (source-level conclusions)

All six tables enable RLS. Client table grants are SELECT-only; writes go through explicitly granted security-definer RPCs with empty search paths and fully qualified table names. Anonymous clients have no table/RPC grants. Service-role and database-owner credentials bypass this client boundary and must remain trusted.

- **Other pubs:** every report/decision/history SELECT requires active membership in that pub. RPCs check the requested pub; composite foreign keys prevent a decision from linking to another pub's report. A manager in A is not a manager in B unless separately assigned there.
- **Self-promotion:** no client INSERT/UPDATE/DELETE grant or write policy exists for memberships. Auth signup creates only a profile; metadata does not assign roles. Role provisioning and changes require trusted administration.
- **Staff manager actions:** creating decisions and lifting bans both require an active manager membership, checked by RPC and trigger. Staff can submit reports but cannot create or lift decisions. Actors and timestamps are assigned server-side.
- **Privacy within a pub:** staff read their own full reports; managers read their pub's full reports. All active members see active decisions. Cross-author identifying report fields are available only through `get_active_decision_incidents`, which excludes description and reporter identity. History is restricted to managers and the report author. The connected frontend uses this projection for active people and never fetches cross-author full reports for staff.
- **History:** original reports and history reject updates/deletes; decisions reject deletion and changes beyond the single lifting transition. Audit insertion happens in the same transaction.

No concrete cross-pub/self-promotion/staff-escalation defect was identified in the source review; the corresponding SQL checks also passed against the local database. The SQL checks exercise PostgreSQL roles and RLS directly. The additional HTTP/JWT suite now also verifies real staff/manager sessions and RPC permissions. RLS is not forced for table owners, which permits the narrowly scoped security-definer helpers to check membership without recursive policies; owner/service credentials are outside the untrusted client threat model.

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

## Connected local fixtures and HTTP checks

Run `npm run prepare:local` from the repository root. This separate Node script discovers only the local stack, enforces an http localhost/127.0.0.1 URL, creates marked fictional accounts with Auth Admin, and provisions the sample pub/memberships through trusted local container SQL. It writes only the client URL/anon key to ignored `.env.local`. Re-running was verified and preserves reports/decisions; existing unrelated accounts are not reassigned. See the root README for the three login emails. The test password is read at runtime from ignored `.env.test.local` (`TEAMBRIEF_LOCAL_TEST_PASSWORD`); no password value is committed.

`npm run test:local` passed with actual password sign-in and bearer JWTs over local HTTP: membership mapping, rejected self-promotion, staff decision/lift denial, own-versus-other report privacy, active summary's exact field allowlist, manager ban/no-ban creation and lifting, author/manager history, unassigned-pub denial, sign-out denial and wrong-password handling. It uses the same adapter as the frontend. Fictional integration reports/history are retained, and test bans are lifted. No privileged key is used by frontend code or this HTTP test suite.

DOM tests verify login errors, logout, no-membership denial, account switching and late old-user responses. Full browser visual interaction was unavailable (no browsers exposed by the computer-use tool). Still pending: manager demotion and concurrent revocation/decision races; broad HTTP/JWT parity with every SQL edge case. No cloud operations, migration reapplication or data reset occurred.
