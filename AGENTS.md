# Repository Guide

## Project structure

- This is a `pnpm` workspace using TypeScript and Node.js 22.5 or newer.
- `apps/web` is the Vite/React static client; `apps/api` is the Express/SSE API.
- `packages/shared`, `config`, `agent`, and `tools` contain shared contracts,
  configuration, model-loop logic, and tools.
- The repo root `Dockerfile` builds the API image. Cloudflare Pages hosts the
  client; Fly.io hosts the API; Neon hosts production Postgres.

## Commands

- `pnpm dev` — run the API and web app locally.
- `pnpm typecheck` — typecheck all workspaces.
- `pnpm --filter @portfolio/api test` — API tests.
- `pnpm --filter @portfolio/web test` — web tests.
- `pnpm build` — build the static client.

Postgres adapter tests run when `TEST_DATABASE_URL` is set. Use only a
disposable local database or Neon development branch: these tests apply schema
migrations and truncate their test tables. CI supplies a disposable Postgres
service.

## Storage and secrets

- Local development defaults to SQLite at `./data/sessions.db`.
- Production explicitly sets `SESSION_STORE=postgres` and uses the pooled Neon
  URL in the Fly `DATABASE_URL` secret. Do not put production URLs in `.env`,
  source files, test output, or build artifacts.
- Postgres schema changes live in `apps/api/migrations/`. Production releases
  apply them using the direct, non-pooled
  `NEON_MIGRATION_DATABASE_URL` GitHub secret.
- The SQLite importer is a one-time operational tool. Do not run it unless the
  task explicitly calls for a data migration; it requires
  `ALLOW_DATABASE_IMPORT=YES` and refuses a non-empty destination.
- `knowledge/knowledge-base.md` is private, generated from Notion, and
  gitignored. Do not commit it or expose its contents in logs or responses.

## API and data conventions

- `SessionStore` methods are asynchronous. If changing its contract, update
  both the SQLite and PostgreSQL adapters and their tests.
- Preserve the shared request/response and SSE contracts in
  `packages/shared`.
- Conversations and usage are stored indefinitely in production unless a
  retention job is added; avoid printing real conversation contents during
  diagnostics.
- Rate-limit and concurrency maps are process-local. Do not add API machines
  or regions without accounting for those limits being per-process.

## Production deployment

- Production changes go through a PR to `main`, then a GitHub Release from a
  tag on `main`. The release workflow syncs Notion, applies database migrations,
  deploys the API, checks health and the admin auth guard, then deploys Pages.
- Do not manually deploy production with `fly deploy` or publish Pages from the
  Cloudflare dashboard; that bypasses the release gate.
- Current topology is one Fly machine in `iad` with Neon Postgres in
  `aws-us-east-1`. The old SQLite volume is detached in `gru` for rollback; do
  not destroy it as routine cleanup.
- Admin routes require Cloudflare Access and independently validate its JWT.
  Keep them fail-closed.
