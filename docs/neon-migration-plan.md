# Neon Database Migration Plan

This plan moves conversation/session storage from the SQLite file on the Fly
volume to Neon Postgres while keeping the API on Fly and the client on
Cloudflare Pages. The application should use standard PostgreSQL drivers and
SQL so Neon can later be replaced by RDS or another Postgres service without
changing the application data model.

## Current Status

The portable implementation is in place: async store contract, SQLite and
Postgres adapters, versioned Postgres schema, explicit migration/import
commands, and Postgres integration tests in CI. It has been validated against
local Postgres, including a SQLite import rehearsal, and against a short-lived
Neon development branch. **Production is not cut over:** Fly still explicitly
selects SQLite, the Fly volume is unchanged, and no production data has been
moved. The Neon `production` branch has not been modified; the test schema and
test rows are confined to `neon-migration-dev`, which expires on 2026-10-21.

## Target Topology

- **Client:** Cloudflare Pages, unchanged.
- **API:** Fly.io `matheus-portfolio-api`, initially unchanged except for its
  database adapter and configuration.
- **Production database:** the existing Neon project
  `young-block-84379034`, branch `production`.
- **Network placement:** verify the project's compute region and measure
  Fly-`gru` to Neon query latency before production cutover; keep the DB close
  to the API unless there is a measured reason not to.
- **Local development:** SQLite at `./data/sessions.db` by default. Local
  development must never use the production connection string.
- **Postgres integration testing:** local Postgres service container in CI;
  optionally use a separate Neon development branch for manual cloud testing.

The application connects through a standard PostgreSQL driver and
`DATABASE_URL`. Do not use a Neon-only HTTP driver; the standard Postgres
protocol is what keeps the API and database provider replaceable.

## Safety Rules

- Never put the production `DATABASE_URL` in the local `.env`, `.env.local`,
  source control, workflow logs, or a build artifact. Store it as a Fly secret.
- `DATABASE_URL` alone must not implicitly select Postgres. Use an explicit
  store setting such as `SESSION_STORE=sqlite|postgres`; local default is
  `sqlite`, and production must explicitly select `postgres` after cutover.
- The supplied Neon setup prompt targets `production` and says `neon deploy`
  writes environment values to `.env.local` or `.env` if it exists. The default
  plan is **not to run that env-pulling deploy against production**: retrieve
  the runtime URL through Neon and add it directly to Fly secrets. If the CLI
  deploy is required for provisioning, first establish a supported way to
  prevent production credentials being written into either local env file; if
  that cannot be guaranteed, do not use the CLI deploy step.
- Keep the Fly volume and original SQLite database intact through the
  observation/rollback window. Do not remove or destroy the volume as part of
  the initial cutover.
- Never test migration/import scripts against the production branch first.

## Phase 1: Initialize Neon Safely

The Neon project already exists. Use the supplied organization/project IDs and
branch name when initializing the repository integration:

```sh
npx neon@latest init -y \
  --org-id org-cool-king-88899391 \
  --project-id young-block-84379034 \
  --branch production \
  --services postgres
```

If the CLI requests browser sign-in, complete it there. If that flow fails,
run `neon login` as the CLI suggests and retry. Review all generated files,
especially `neon.ts`, package changes, and environment-file changes. Keep only
non-secret project configuration in Git. Since the Neon project already exists,
use the CLI initialization only for repository integration unless provisioning
is actually needed. Do not run the suggested `neon deploy` against the
production branch by default: its local env-file injection conflicts with the
local SQLite-only workflow. Retrieve the production runtime URL through Neon
and add it directly to Fly secrets during cutover. If provisioning is needed,
use `neon deploy` only after its env-file destination and branch are confirmed
safe; otherwise provision through the Neon dashboard.

Before testing application writes, create or designate a separate Neon
development branch for manual cloud integration tests. Do not make local
development or CI depend on Neon branch APIs.

## Phase 2: Make the Store Portable

1. Evolve the existing `SessionStore` type into an asynchronous interface.
   Keep the SQLite implementation for local development and tests; async
   methods can wrap the existing synchronous SQLite operations.
2. Propagate `await` through chat service, budget ledger, and admin handlers.
   Make budget checks, usage writes, dashboard queries, transcript reads, and
   session/message/tool-call writes asynchronous.
3. Add a Postgres implementation using a standard Node Postgres client (for
   example, `pg` or `postgres`). Use TLS and a bounded connection pool suitable
   for the single Fly machine. Keep provider-specific connection handling out
   of application logic.
4. Select the adapter explicitly from configuration. SQLite remains the local
   default; production Postgres requires both `SESSION_STORE=postgres` and a
   valid `DATABASE_URL`. Fail startup with a clear error if the selected
   adapter's configuration is missing.
5. Keep the existing API and Pages deployment topology during this work. This
   migration does not require moving the API to Workers or changing the client.

## Phase 3: Add Postgres Schema and Tests

1. Move schema creation out of the SQLite adapter into versioned SQL migration
   files. Maintain a schema-migrations table and an explicit migration command.
2. Implement the Postgres schema for `sessions`, `messages`, `tool_calls`, and
   `usage`, preserving foreign keys, role constraints, indexes, and the
   intentional lack of a foreign key from `usage` to `sessions`.
3. Replace SQLite-specific DDL and assumptions, including
   `INTEGER PRIMARY KEY AUTOINCREMENT`, `?` placeholders, SQLite result types,
   and connection-specific behavior. Preserve UTC timestamps and normalize
   Postgres `BIGINT`/count results before returning the existing API types.
4. Make message/tool-call ordering safe under concurrent requests. The current
   SQLite adapter computes `MAX(seq) + 1`; do not reproduce that as an
   unprotected read-then-insert in Postgres. Use a database-generated sequence
   or another atomic allocation strategy while preserving per-conversation
   ordering expected by the API/dashboard.
5. Add adapter conformance tests that run the same store behavior tests against
   SQLite and Postgres. Run Postgres integration tests against a disposable
   local Postgres service in CI. Keep unit tests fast and independent of Neon.
6. Test daily budget reads/writes, UTC-day boundaries, admin overview, complete
   transcript reads, cascade behavior, and concurrent appends. Confirm budget
   enforcement behavior under concurrent requests; do not silently weaken the
   global token cap during the async conversion.

## Phase 4: Local and CI Configuration

- Keep the normal local `.env` on SQLite (`SESSION_STORE=sqlite`,
  `SESSION_DB_PATH=./data/sessions.db`) and omit `DATABASE_URL`.
- If testing the Postgres adapter locally, use a disposable local Postgres
  container or a dedicated Neon development branch. Never use the `production`
  branch for local writes.
- Add `.env.example` entries for the explicit store selector and a blank
  `DATABASE_URL`; document that the URL is only required for Postgres mode.
- Add CI variables/secrets only for a disposable integration database if
  needed. Prefer a Postgres service container so CI does not need access to the
  Neon production project.
- Add the Postgres migration/test command to CI before enabling Postgres in
  production.

## Phase 5: Rehearse the Data Migration

1. Use `pnpm --filter @portfolio/api db:import-sqlite` for the one-time importer
   from the current SQLite schema to Postgres. It preserves session IDs,
   transcripts, tool calls, usage rows, timestamps, and sequence/order values;
   wraps Postgres inserts in a transaction; and refuses a non-empty destination.
   The command requires `ALLOW_DATABASE_IMPORT=YES` as explicit confirmation.
2. Back up the production SQLite database from the Fly volume and record its
   size/row counts. Do not copy the file while SQLite may be writing to it;
   use a SQLite-consistent backup or stop writes for the copy.
3. Import a copy into the Neon development branch. Compare row counts and
   representative transcript/dashboard results between SQLite and Postgres.
4. Exercise the Postgres-backed API against the development branch: health,
   chat (including streaming and cancellation), follow-up history, budget
   accounting, `/admin/overview`, and transcript retrieval.
5. Verify migrations against an empty Postgres database as well as an imported
   database. Confirm secrets and connection strings do not appear in logs.

## Phase 6: Production Cutover

Use a planned short maintenance window; the portfolio's low write volume makes
a brief pause safer than dual-writing two databases.

1. Take and verify a final SQLite backup. Keep the Fly volume intact.
2. Pause chat writes or stop the API so no conversations or usage rows change
   during the final export/import.
3. Apply versioned schema migrations to the Neon `production` branch using a
   direct migration connection. Use the Neon pooled connection string for the
   running API if appropriate for the selected driver; keep these URLs in
   secrets, not files or logs.
4. Import the final SQLite snapshot and verify row counts, latest timestamps,
   usage totals, dashboard results, and sample transcripts.
5. Set `DATABASE_URL` (pooled runtime URL) as a Fly secret. The release
   manifest sets `SESSION_STORE=postgres` and `primary_region=iad`; the release
   workflow applies migrations from the direct migration URL before deploying.
   Ensure a healthy `iad` machine is running on the shared Neon database before
   stopping the old `gru` machine. Keep the old SQLite volume and snapshot
   unattached and intact.
6. Verify `/health`, a real streamed chat, a second turn using stored history,
   budget recording, `/admin/overview`, and transcript retrieval. Check Fly and
   Neon logs/metrics for connection or query errors.
7. Resume normal traffic only after these checks pass. Do not publish a Pages
   change solely for the DB cutover; the client API URL and contract are
   unchanged.

## Release and Migration Automation

- `.github/workflows/production-release.yml` now applies versioned migrations
  before deploying the API, using the `NEON_MIGRATION_DATABASE_URL` GitHub
  secret. That secret must contain a direct (non-pooled) URL and must not be
  printed by workflow logs.
- Keep schema changes backward-compatible across deploy order where possible:
  expand schema first, deploy code, then remove obsolete schema in a later
  release.
- Keep the one-time SQLite data import a separately invoked, audited operation;
  never run it automatically on every API boot or every release.
- The existing release workflow deploys the API before Pages. Preserve that
  ordering and its health/admin checks.

## Rollback

- **Before accepting writes on Neon:** stop the new API, point it back to the
  SQLite adapter, and restore/use the untouched Fly volume.
- **After accepting writes on Neon:** switching back to the old SQLite file
  would lose conversations and usage written since cutover. Rollback then
  requires a reverse export/import or a deliberate maintenance window and
  reconciliation. Document and test the reverse path before cutover; do not
  describe a simple application rollback as data-safe.
- Keep the volume and verified backup until the observation period has passed
  and the restore procedure has been proven. Only then remove the Fly mount in
  a separate change.

## Completion Criteria

- Local development and ordinary tests remain independent of Neon production.
- CI exercises the Postgres adapter against real Postgres.
- The same API build works with SQLite locally and Postgres in production by
  configuration; application code does not import Neon-specific APIs.
- Production transcripts, usage, and budget checks pass end to end on Neon.
- A Neon export can be restored to another standard Postgres service using the
  documented migration/restore steps.
- The old SQLite volume is retained until rollback is no longer needed, then
  removed in a separately reviewed cleanup.
