# Production Deployment

This is the source of truth for the currently deployed chat site. It contains
resource names and configuration, never secret values.

## Topology

- **Frontend:** Cloudflare Pages project `ai-powered-portfolio`, built from
  this repository's `main` branch.
- **Production domains:** `https://matheusgalvao.com` and
  `https://www.matheusgalvao.com` (both attached to the Pages project).
- **API:** Fly.io app `matheus-portfolio-api` in `gru`, served at
  `https://api.matheusgalvao.com` and `https://matheus-portfolio-api.fly.dev`.
- **Database:** SQLite at `/data/sessions.db` on the Fly volume
  `portfolio_data` (1 GB). Do not scale this single-volume app to multiple
  machines without redesigning the storage layer.

## Cloudflare Pages

Production build settings:

- Repository: `matheusgalvao1/ai-powered-portfolio`
- Production branch: `main`
- Root directory: repository root
- Build command: `pnpm run build`
- Build output directory: `apps/web/dist`
- `NODE_VERSION=22`
- `VITE_API_BASE_URL=https://api.matheusgalvao.com`

Pages builds and publishes automatically on pushes to `main`. Both apex and
`www` are Pages custom domains; the API CORS allowlist accepts both exact
origins. If the custom domains are re-created, attach them in the Pages
project's **Custom domains** settings rather than pointing them at the API.

`VITE_API_KEY` is currently unset because the API's optional `API_KEY` check is
also unset. If enabling it, set matching values: `API_KEY` as a Fly secret and
`VITE_API_KEY` as a Pages production build variable, then redeploy both. This
shared key is visible in the built browser bundle and is only an abuse
deterrent, not authentication.

## Fly API

The app configuration is in the root `fly.toml`; the portable image is built
by the root `Dockerfile`. Deploy from the repository root with an authenticated
Fly CLI:

```sh
fly deploy --app matheus-portfolio-api
```

Check deployment health and logs with:

```sh
fly status --app matheus-portfolio-api
fly logs --app matheus-portfolio-api
```

The Fly app's secret/environment variable names are `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL_ID`, `OPENROUTER_SITE_NAME`, `OPENROUTER_SITE_URL`,
`ALLOWED_ORIGINS`, `CONTACT_EMAIL`, `CONTACT_LINKEDIN`, `CONTACT_GITHUB`,
`ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, and `ADMIN_ACCESS_EMAIL`.
`API_KEY` is optional and currently unset.
The live CORS allowlist is the comma-separated pair
`https://matheusgalvao.com,https://www.matheusgalvao.com`. Secret **values**
belong in Fly secrets or the local gitignored `.env`, never in Git or this
document.

Production chat monitoring uses the same SQLite volume through read-only
`/admin/*` API routes. Before opening `/admin` in Pages, configure Cloudflare
Access applications for `matheusgalvao.com/admin*` and
`api.matheusgalvao.com/admin/*`, each restricted to the operator email. Set
`ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD` (the API application's AUD tag),
and `ADMIN_ACCESS_EMAIL` in Fly. The API validates the Access JWT's
signature, issuer, audience, expiry, and email; the admin API fails closed when
these settings are absent. Direct requests to the Fly hostname are also denied
without a valid Access JWT.

`fly.toml` sets `TRUST_PROXY=2` for the Cloudflare-to-Fly proxy chain and
`SESSION_DB_PATH=/data/sessions.db`. It runs one `shared-cpu-1x` machine with
512 MB RAM and suspends it when idle. The app also has a public `*.fly.dev`
hostname; Cloudflare's per-IP edge controls do not protect that direct route.
The API's own rate limits and global daily token budget still apply.

The Fly hostname's custom TLS certificate is managed by Fly. Cloudflare DNS
proxies `api.matheusgalvao.com` to the app-specific Fly hostname and has the
Fly ownership TXT record. If changing DNS or re-creating the certificate, run
`fly certs setup api.matheusgalvao.com --app matheus-portfolio-api` and follow
the current instructions it prints.

## GitHub Automation

- `.github/workflows/ci.yml` runs typecheck and web build on pushes to `main`
  and pull requests.
- Cloudflare Pages deploys the frontend from `main` through its GitHub
  integration.
- Fly deploys are currently **manual** with `fly deploy`; there is no
  GitHub Actions Fly deploy workflow.
- `.github/workflows/sync-notion.yml` runs a weekly Monday canary and can be
  started manually. It verifies Notion access and the sync script but
  deliberately does not commit, upload an artifact, or deploy knowledge data.
- The Notion canary reads the GitHub Actions secrets `NOTION_API_KEY` and
  `NOTION_ROOT_PAGE_ID`.

The GitHub repository is private. If Pages reports a repository permission
error, check the Cloudflare Pages GitHub App's access to this repository.

## Knowledge Files and Sessions

`knowledge/knowledge-base.md` and `knowledge/portfolio.json` are gitignored.
The API reads them at startup, and the Dockerfile copies them into the image.
Therefore, deploy from a local checkout where both files exist; a fresh GitHub
Actions checkout does not contain them. Do not commit these personal files.
`pnpm sync:notion` regenerates `knowledge/knowledge-base.md` locally only; the
weekly workflow is a canary, not a production content-sync pipeline.

The `portfolio.json` in this checkout was empty when the deployment was
prepared; populate it with structured projects if the `list_projects` tool
should return project entries.

Conversation messages and tool calls are stored in SQLite and currently have
no automatic retention/deletion job. The privacy notice in the chat reflects
that storage behavior. The usage table backs the daily budget circuit breaker
and survives machine restarts because it lives on the volume.

## Current Follow-ups

- Add an automated, privacy-safe Notion publishing workflow if knowledge
  updates should deploy without a local Fly CLI. The workflow must source
  private knowledge files without committing them or exposing them as public
  artifacts.
- Add a retention policy/job for stored conversations.
- Consider enabling the optional shared API key together with the matching
  Pages build variable; it is not a substitute for the rate and budget limits.
