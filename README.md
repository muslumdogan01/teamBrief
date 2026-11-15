# TeamBrief

An English-only pub incident reporting and service-ban application using React, TypeScript, Vite and **local Supabase**. The normal entry point uses real email/password authentication and database memberships; there is no demo role selector.

## Run on this computer

Docker Desktop and the existing local `teambrief` Supabase stack must be running. No cloud project, link, deployment or remote database commands are needed.

```sh
npm install
# Create ignored .env.test.local with TEAMBRIEF_LOCAL_TEST_PASSWORD before preparing accounts.
npm run prepare:local
npm run dev -- --host 127.0.0.1
```

The preparation script discovers the running local stack, creates the fictional pub/test accounts and writes only the URL and client anon/publishable key to ignored `.env.local`. It is repeatable, does not reset the database, and never imports browser records. On this Mac Docker lives under `/Applications/Docker.app/Contents/Resources/bin`; the script handles that path. `.env.example` contains only empty variable names. Missing/invalid configuration displays an English error; restart Vite after changing environment settings.

Open `http://127.0.0.1:5173` (or the port Vite prints). The test account password is stored only in ignored `.env.test.local` as `TEAMBRIEF_LOCAL_TEST_PASSWORD`; use that local value to sign in. For a fresh setup, choose a local test password of at least 12 characters before running the preparation script:

| Email | Name | Pub role |
| --- | --- | --- |
| `staff1@teambrief.test` | Jamie Example | Staff |
| `staff2@teambrief.test` | Taylor Example | Staff |
| `manager@teambrief.test` | Morgan Example | Manager |

These accounts are fictional and local-only. Never commit `.env.test.local` or paste its password into documentation. The preparation and HTTP test scripts read it at runtime; there is no hard-coded account password. The script refuses non-loopback Supabase URLs and remote Docker sockets. It uses local administrative credentials only in the Node process and trusted container SQL; privileged credentials are never written to frontend configuration. It refuses to overwrite accounts with matching emails unless they carry the local fixture marker. Re-running preserves existing passwords and incident/decision records while restoring the fixture names and memberships.

## Try the connected workflow

1. Sign in as staff1. Submit a past incident from **Report Incident**; find it in **My Incidents**.
2. Sign out and sign in as manager. Open **Management**, read the full report and create a ban with a reason, service instructions and future review time, or choose **No ongoing ban required**.
3. Sign in as staff2. **My Incidents** does not show staff1’s full report. **Active Decisions** shows the ban and the permitted identifying summary, without the original description or reporter identity.
4. As manager, lift the ban with a reason. Staff2 loses access to that decision/person summary after refresh (automatic within 15 seconds or on window focus). The author and manager retain the review outcome/history. **Decision history** is available to managers.
5. Sign out or switch accounts: the previous account workspace is unmounted, memory records/forms are cleared, and delayed responses cannot populate the new workspace. Accounts without an active pub membership see **Access not granted**. Multiple memberships offer only pubs actually returned by RLS; roles cannot be chosen.

Low severity never permits service while a ban is active. Review-overdue bans remain active until explicitly lifted. Mutation errors never display success; a successful write followed by refresh failure explicitly warns against retrying a duplicate submission. Loading, empty, retry and error states are provided. Database records refresh every 15 seconds and on window focus.

## Data boundaries

`src/backend.ts` maps SQL snake_case/UUIDs to separate connected TypeScript models and maps `staff` to the existing UI role `employee`. It uses the four existing RPCs for submission, decisions, lifting and active-person summaries. Staff full-report queries explicitly filter by their own account in addition to server RLS. Names of other accounts are not exposed by the existing profiles policy, so report/decision/history actor fields display account UUIDs; no broader profile access was added.

Auth sessions use a dedicated **sessionStorage** key. Existing `teambrief.reports.v1`, `teambrief.data.v2` and `teambrief.data.v3` localStorage records are neither read, changed, deleted nor uploaded by the connected entry point. The old demo component/data migration remain in source for backwards-compatibility tests; there is no automatic demo fallback or mixing with database records.

Dates use `en-IE` and the browser’s local time zone. Incident/severity/status/decision codes are unchanged. Photo uploads are not implemented.

## Checks

```sh
npm test
npm run build
npm run test:local
```

The 19 automated tests include the original 14 demo tests plus connected configuration, error/adapter, login/logout, membership denial and delayed-response isolation checks (DOM tests via jsdom). Real HTTP/JWT checks use the three local accounts, exercise the backend adapter and permissions, and retain fictional reports/audit history with test bans lifted. They do not delete existing records or reset/apply migrations.

The existing migration and 66 SQL access checks also passed in local PostgreSQL. See [`supabase/README.md`](supabase/README.md) for commands and verification limits. Full visual/browser testing was unavailable because the computer-use tool exposed no browsers. Manager demotion/concurrent revocation races remain outside the current integration suite.
