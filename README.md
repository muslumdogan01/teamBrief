# TeamBrief

An English-only pub incident reporting and service-ban application using React, TypeScript, Vite and **local Supabase**. The normal entry point uses real email/password authentication and database memberships; there is no demo role selector.

## Run on this computer

Docker Desktop and the existing local `teambrief` Supabase stack must be running with Storage enabled. No cloud project, link, deployment or remote database commands are needed.

If the previous stack excluded `storage-api`, restart it with the normal backup-preserving stop before applying pending migrations:

```sh
npx --no-install supabase stop
npx --no-install supabase start --exclude realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

```sh
npm install
npx --no-install supabase migration up --local
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
4. As manager, lift the ban with a reason and a separate service note for the team. Home and Active Decisions show the latest 20 lift updates for the selected pub. Each active member can mark updates as read, and that status follows their account across sessions. Staff2 loses access to that decision/person summary after refresh (automatic within 15 seconds or on window focus). The author and manager retain the review outcome/history. **Decision history** is available to managers.
5. Sign out or switch accounts: the previous account workspace is unmounted, memory records/forms are cleared, and delayed responses cannot populate the new workspace. Accounts without an active pub membership see **Access not granted**. Multiple memberships offer only pubs actually returned by RLS; roles cannot be chosen.

Low severity never permits service while a ban is active. Review-overdue bans remain active until explicitly lifted. Mutation errors never display success; a successful write followed by refresh failure explicitly warns against retrying a duplicate submission. Loading, empty, retry and error states are provided. Database records refresh every 15 seconds and on window focus.

## Active ban directory

**Home** shows a compact summary of the current pub's active bans and your own incidents. Managers also see the number of incidents awaiting review. These totals come from the database independently of list pagination. The Home directory shows up to 20 bans in a keyboard-scrollable area on desktop and up to 5 in the normal page flow on mobile. **Recent Updates** follows the directory.

On **Home** or **Active Decisions**, search the full active list for a case-insensitive substring of a person label or physical description. Home applies its display limit to matching results. **View all results** carries the search into **Active Decisions**, where **Next** and **Previous** navigate 20 results at a time. Clear the field to restore the default list. Pages are ordered by decision time and then decision UUID, with live data and a cursor over both values. A lift removes the entry on refresh. New bans created while browsing older pages are visible on the first page. **My Incidents** remains the list of reports you submitted.

## Incident and decision status

**My Incidents** shows the incident date and derives each badge from the report's linked decision: **Awaiting review**, **Active ban**, **Ban lifted** or **No ban required**. **Decision history** includes active bans, lifted bans and no-ban decisions. It shows the decision date for every row and the lifted date when applicable. An overdue review leaves the ban active.

The incident query embeds the linked decision and photo metadata under the existing access policies. Status does not depend on the separate decision list or a new database column. Loading errors leave the affected lists unavailable until a successful refresh. Records are loaded in batches with date and ID cursors so the manager's history can include older decisions.

## Data boundaries

`src/backend.ts` maps SQL snake_case/UUIDs to separate connected TypeScript models and maps `staff` to the existing UI role `employee`. It uses Supabase RPCs for submission, decisions, lifting, the active-ban directory, exact totals, Recent Updates and marking updates as read. A lift writes the audit entry and team update in the same transaction. Existing lifted bans are not backfilled. Staff full-report queries explicitly filter by their own account in addition to server RLS. Names of other accounts are not exposed by the existing profiles policy, so report/decision/history actor fields display account UUIDs; no broader profile access was added.

Auth sessions use a dedicated **sessionStorage** key. Existing `teambrief.reports.v1`, `teambrief.data.v2` and `teambrief.data.v3` localStorage records are neither read, changed, deleted nor uploaded by the connected entry point. The old demo component/data migration remain in source for backwards-compatibility tests; there is no automatic demo fallback or mixing with database records.

Dates use `en-IE` and the browser’s local time zone. Incident/severity/status/decision codes are unchanged.

## Incident photos

Choose one optional JPEG, PNG or WebP (up to **5 MB / 5,000,000 bytes**) when reporting an incident. The standard picker opens files or the gallery. Touch devices also offer a camera picker. Preview, replace or remove the selected photo before saving. HEIC files need conversion first. A saved photo is immutable from the app.

The private `incident-photos` bucket enforces size and declared MIME type. The browser also checks the file signature before preview and display. Original bytes are stored, including any embedded metadata. PostgreSQL stores the bucket and object path. An active pub member can download a photo if they filed the incident, manage that pub, or the incident currently has an active service ban. Recent Updates contains the service note independently of photo access. The app uses authenticated downloads with in-memory blob URLs. Storage policies deny signed URL creation to app accounts. A signed URL issued separately by a trusted administrator can remain usable until its expiry, and revocation cannot retrieve bytes that a recipient already downloaded.

The browser reserves a random path, uploads once and finalizes the report and attachment metadata together in PostgreSQL. Retry from the same open form to reuse the submission ID after an error. If the page was reloaded after an uncertain save, check **My Incidents** before creating a new report. Changing or removing an unsaved photo attempts to delete the abandoned upload through the Storage API. Browser closure, sign-out or network failure can interrupt cleanup. Staged objects are inaccessible to viewers and become eligible for local maintenance after 24 hours. From the project root, run `npm run cleanup:local:photos` to remove abandoned or expired reservations and their staged bytes. Pass one or more report UUIDs after `--` to limit cleanup to those reports. The command skips linked photos. It uses privileged credentials only in the trusted local maintenance process.

## Checks

```sh
npm test
npm run build
npm run lint
npm run test:local
npm run test:local:photos
```

The application tests cover the demo flows, connected configuration and authentication, delayed-response isolation, and photo selection, preview, replacement, removal, upload progress and form retention after an error (DOM tests via jsdom). Real HTTP/JWT checks use the three local accounts, exercise the backend adapter and permissions, and retain fictional reports/audit history with test bans lifted. They do not delete existing records or reset/apply migrations.

Run the SQL access and rollback checks against local PostgreSQL after applying pending migrations. See [`supabase/README.md`](supabase/README.md) for the SQL command. The photo HTTP suite uses synthetic images and real local JWTs for owner, manager, other staff, other pub, inactive and anonymous access. It covers revocation after lifting, Storage write denials, file limits, text-only submission, lost upload acknowledgements and staged cleanup.

The SQL suite generates 24 active bans inside a rollback transaction. It verifies the 20/5 limits, matches beyond the first page, exact totals and tied decision timestamps across the page boundary. The HTTP suites also verify the directory projection, photo access, lifted-ban exclusion and denial for other pubs, inactive users and anonymous requests.
