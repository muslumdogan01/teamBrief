# TeamBrief

An English-only incident reporting and service ban management demo for pub teams, built with React, TypeScript, Vite and plain CSS.

## Run locally

```sh
npm install
npm run dev
```

Open the address printed in the terminal. Use the same browser and address/port to access existing records. Data is stored only in localStorage and is lost if browser data is cleared.

## Demo profiles and workflow

The profile selector offers **Müslüm — Employee** and **Alex — Manager**. These are demo views, not real authentication or access control. Switching profiles does not delete records. Reloading starts in the employee view.

1. As Müslüm, open **Report Incident** and submit a report with a past date and time. Reports start as **Awaiting review** and appear in **My Reports**.
2. Switch to Alex and open **Management → Awaiting review**. Read the original report and choose **Create service ban** or **No ongoing ban required**. Both decisions require a reason.
3. A service ban also requires a final severity, service instructions and a future review date and time. The original report is kept separate from the manager’s decision.
4. View **Active Decisions** as either profile. Follow the service instructions regardless of severity: **low severity does not permit service**.
5. The review date triggers a **Review overdue** warning; it never lifts a ban automatically. The warning refreshes within 15 seconds.
6. As Alex, open the active ban, enter a reason and select **Lift ban with reason**. It leaves the active list but remains in **Management → Decision history** and the report’s review outcome, including who lifted it, when and why.
7. Reload and switch profiles to confirm records are retained. Home shows total reports, reports awaiting review and active bans.

All required text fields reject whitespace-only input. Future incident times and past review times are rejected. Storage failures keep the form available and display an error. Navigation stays on the left on desktop and along the bottom on mobile.

## English labels and stored codes

The document language is `en`. Displayed dates and times use `en-IE` in the user’s local time zone. There is no language selector or translation package. Names and user-entered labels, descriptions, decision explanations, service instructions and lifting reasons are not translated.

Stored codes are independent of labels:

- Report status: `pending_review` → Awaiting review. Review outcomes are derived from separate decisions.
- Demo roles: `employee`, `manager`.
- Incident types: `aggressive_behaviour`, `causing_disturbance`, `intoxication`, `rule_violation`, `other`.
- Severity: `low`, `medium`, `high`.
- Decision kinds: `ban`, `no-ban`. A ban is active until it has a `lifted` record.

## Backwards-compatible storage migration

On first opening this version, `teambrief.data.v2` is migrated to `teambrief.data.v3`. If v2 is absent, the original `teambrief.reports.v1` records are migrated. Both legacy keys remain unchanged as backups. Subsequent loads use v3 without duplicating or resetting records.

The migration converts the original Turkish incident types, `İnceleme bekliyor` status and Turkish severity labels into stable English codes. It preserves IDs, timestamps, report text, decision reasons, instructions and lifting history, including whitespace. Overdue bans remain active. Invalid data is not silently deleted or overwritten.

The app still reads and writes **localStorage only**. No Supabase client, frontend connection, real sign-in or photo upload is implemented. The SQL files below are preparation artifacts; they do not migrate browser records.

## Supabase preparation (not connected)

- Schema: `supabase/migrations/20261113000100_teambrief_schema.sql`.
- Database access checks: `supabase/tests/database/access.sql`.
- Model mapping, security review and verification limits: [`supabase/README.md`](supabase/README.md).

The schema defines pub memberships, incident reports, manager decisions and immutable decision history. SQL roles are `staff` and `manager`; the demo TypeScript role `employee` will need to map to `staff`. Memberships can only be managed by a trusted administrator, not through the demo profile selector.

**Local database verification passed on 15 November 2026.** Supabase CLI 3.1.0 applied migration `20261113000100` to the local PostgreSQL 17 database. The unchanged access SQL passed all 66 checks through container `psql` with `ON_ERROR_STOP=1`; fixtures were rolled back. The 14 frontend tests and production build also passed. No cloud Supabase operations were performed; API/JWT integration and concurrency checks remain pending. See the Supabase README for repeatable local commands.

## Checks

```sh
npm test
npm run build
```

Tests use Node.js 22.19 or a compatible newer version. They cover migration, user text preservation, validation messages, English labels, server-rendered interface output, en-IE dates, demo access rules and the decision lifecycle. No additional test packages are required.

Production output is written to `dist/`. Use `npm run preview` to inspect it locally.
