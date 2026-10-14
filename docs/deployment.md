# Production Deployment

This is the source of truth for the currently deployed chat site. It contains
resource names and configuration, never secret values.

## Topology

- **Frontend:** Cloudflare Pages project `ai-powered-portfolio`, built from
  this repository's `main` branch.
- **Production domains:** `https://matheusgalvao.com` and
  `https://www.matheusgalvao.com` (both attached to the Pages project).
- **API:** Fly.io app `matheus-portfolio-api`, one `shared-cpu-1x`/512 MB
  machine in `iad`, served at
  `https://api.matheusgalvao.com` and `https://matheus-portfolio-api.fly.dev`.
- **Database:** Neon Postgres project `young-block-84379034`, branch
  `production`, region `aws-us-east-1`. Runtime uses the pooled connection URL
  from the Fly `DATABASE_URL` secret; migrations use the direct URL in GitHub's
  `NEON_MIGRATION_DATABASE_URL` secret.

Local development still defaults to SQLite. The original Fly volume
`portfolio_data` (1 GB) remains detached in `gru` as a rollback copy, with a
final snapshot retained by Fly. Do not reattach or delete it during ordinary
deploys.

## Cloudflare Pages

Production build settings:

- Repository: `matheusgalvao1/ai-powered-portfolio`
- Production branch: `main`
- Root directory: repository root
- Build command: `pnpm run build`
- Build output directory: `apps/web/dist`
- `NODE_VERSION=22`
- `VITE_API_BASE_URL=https://api.matheusgalvao.com`

Pages keeps Git-based preview deployments, but automatic production-branch
deployments are disabled. The production release workflow uploads the built
client with Wrangler only after the API deploy and health check succeed. Both
apex and `www` are Pages custom domains; the API CORS allowlist accepts both
exact origins. If the custom domains are re-created, attach them in the Pages
project's **Custom domains** settings rather than pointing them at the API.

`VITE_API_KEY` is currently unset because the API's optional `API_KEY` check is
also unset. If enabling it, set matching values: `API_KEY` as a Fly secret and
`VITE_API_KEY` as a Pages production build variable, then redeploy both. This
shared key is visible in the built browser bundle and is only an abuse
deterrent, not authentication.

## Fly API

The app configuration is in the root `fly.toml`; the portable image is built
by the root `Dockerfile`. Production deploys are release-gated: merge through a
PR, then publish a GitHub Release from a tag on `main`. Do not manually run
`fly deploy` in production.

Check deployment health and logs with:

```sh
fly status --app matheus-portfolio-api
fly logs --app matheus-portfolio-api
```

The Fly app's secret/environment variable names are `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL_ID`, `OPENROUTER_SITE_NAME`, `OPENROUTER_SITE_URL`,
`ALLOWED_ORIGINS`, `CONTACT_EMAIL`, `CONTACT_LINKEDIN`, `CONTACT_GITHUB`,
`ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, `ADMIN_ACCESS_EMAIL`, and
`DATABASE_URL` (pooled Neon runtime URL).
`API_KEY` is optional and currently unset.
The live CORS allowlist is the comma-separated pair
`https://matheusgalvao.com,https://www.matheusgalvao.com`. Secret **values**
belong in Fly secrets or the local gitignored `.env`, never in Git or this
document.

Production chat monitoring reads the same Neon Postgres database through
read-only `/admin/*` API routes. Before opening `/admin` in Pages, configure
Cloudflare Access applications for `matheusgalvao.com/admin*` and
`api.matheusgalvao.com/admin/*`, each restricted to the operator email. Set
`ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD` (the API application's AUD tag),
and `ADMIN_ACCESS_EMAIL` in Fly. The API validates the Access JWT's
signature, issuer, audience, expiry, and email; the admin API fails closed when
these settings are absent. Direct requests to the Fly hostname are also denied
without a valid Access JWT.

The deployed release sets `TRUST_PROXY=2` for the Cloudflare-to-Fly proxy chain
and `SESSION_STORE=postgres`. It runs one `shared-cpu-1x` machine in `iad` with
512 MB RAM and suspends it when idle. The app also has a public `*.fly.dev`
hostname; Cloudflare's per-IP edge controls do not protect that direct route.
The API's own rate limits and global daily token budget still apply.

The Fly hostname's custom TLS certificate is managed by Fly. Cloudflare DNS
proxies `api.matheusgalvao.com` to the app-specific Fly hostname and has the
Fly ownership TXT record. If changing DNS or re-creating the certificate, run
`fly certs setup api.matheusgalvao.com --app matheus-portfolio-api` and follow
the current instructions it prints.

## GitHub Automation

- `.github/workflows/ci.yml` runs API/web tests, typecheck, and web build on
  pushes to `main` and pull requests. CI does not deploy production.
- `.github/workflows/production-release.yml` runs when a GitHub Release is
  published. It verifies the tag is on `main`, syncs the Notion Markdown,
  applies Postgres migrations using `NEON_MIGRATION_DATABASE_URL`, deploys the
  API to Fly, checks API health and the admin auth guard, then deploys the Pages
  client from the same release commit. After the API is
  healthy, it records the released API tag and knowledge digest in GitHub's
  `production-api` deployment history.
- To ship, merge changes through a PR, then publish a GitHub Release from a tag
  on `main`. Do not deploy Pages directly from the Cloudflare dashboard; the
  release workflow is the production gate for both services.
- Running **Production release** manually from the `main` branch performs a
  validation-only dry run; it never deploys production.
- `.github/workflows/sync-notion.yml` checks Notion every Monday at 06:00 UTC.
  It checks out the latest successful `production-api` deployment, hashes the
   generated Markdown, and redeploys only the Fly API if the knowledge changed.
   It never deploys Pages. Manual runs default to validation-only; set `deploy`
   to true to publish a detected change immediately. `PRODUCTION_API_TAG` is a
   bootstrap fallback; subsequent runs use successful API deployment records.
- Cloudflare Pages automatic production-branch deployments must remain disabled
  so the client cannot publish ahead of the API. Git-based preview deployments
  may remain enabled.
- Required GitHub Actions secrets: `CLOUDFLARE_API_TOKEN` (Cloudflare Pages
  Edit permission), `FLY_API_TOKEN` (app-scoped Fly deploy token),
  `NEON_MIGRATION_DATABASE_URL` (direct, non-pooled Postgres URL),
  `NOTION_API_KEY`, and `NOTION_ROOT_PAGE_ID`. Required repository variables:
  `CLOUDFLARE_ACCOUNT_ID`, `VITE_API_BASE_URL`, and the bootstrap
  `PRODUCTION_API_TAG`.
- `FLY_API_TOKEN` is app-scoped and expires after one year; rotate it before
  expiration and update the GitHub Actions secret.
The GitHub repository is private. If Pages reports a repository permission
error, check the Cloudflare Pages GitHub App's access to this repository.

## Knowledge Files and Sessions

`knowledge/knowledge-base.md` is gitignored because it contains personal
content synced from Notion. The API reads it at startup, and the Dockerfile
copies it into the image. The production release workflow regenerates it from
Notion immediately before the Fly deploy; a manual local `fly deploy` requires
running `pnpm sync:notion` first. The assistant uses this Markdown context for
background, experience, skills, and project questions. There is no separate
structured project data file or `list_projects` tool now.

Conversation messages and tool calls are stored in Neon Postgres and currently
have no automatic retention/deletion job. The privacy notice in the chat
reflects that storage behavior. The usage table backs the daily budget circuit
breaker and survives API restarts.

The v1.1.0 cutover imported the SQLite data from the final Fly snapshot and
verified sessions, messages, usage totals, and per-session counters. The
original Fly volume remains detached in `gru` with snapshots available for
rollback; do not destroy it until the rollback window has passed.

## Current Follow-ups

- Add a retention policy/job for stored conversations.
- Consider enabling the optional shared API key together with the matching
  Pages build variable; it is not a substitute for the rate and budget limits.
