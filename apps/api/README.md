# @portfolio/api

REST API for the portfolio chatbot. TypeScript, Express, no framework beyond that. Request/stream types come from `@portfolio/shared`; model/server/CORS/agent-limit config comes from `@portfolio/config`; the agent loop and tools come from `@portfolio/agent` and `@portfolio/tools`.

## Running

From the repo root:

```bash
pnpm --filter @portfolio/api dev
```

or just `pnpm start:api` / `pnpm dev` (both apps) from the root. Listens on `http://localhost:3001` by default. Development runs via `tsx watch`; production runs from the root Dockerfile on Fly.io. `pnpm --filter @portfolio/api typecheck` runs `tsc --noEmit`.

## The agent

Each `/chat` request runs a hand-rolled agent loop (`@portfolio/agent`, 12-factor pattern — no agent framework):

- **Unified reducer state**: one object carries `steps`, `status`, the native message array, and the final answer — the loop is state-in/state-out, unit-tested without mocking HTTP (`packages/agent/src/loop.test.ts`).
- **Native messages, no serialization**: the loop sends a real multi-turn message array (server-loaded session history, this turn's request with any attachment content parts) and appends the assistant's tool-call messages and tool results as it runs. Every step sees the real conversation shape.
- **Plain-text termination**: the model answers by writing text with no tool calls — that response is the final answer, already streamed to the user. Tool calls mean "keep going"; a tool-free response means "done".
- **Bounded emptiness**: an empty tool-free response gets one retry with a system nudge; a second one fails the turn through the `max_steps` path.
- **Truncation detection**: `stopReason` is captured per step. A `max_tokens` truncation completes with the partial text and logs a loud server-side warning; truncation isn't surfaced to the client yet by design.

Tools (`@portfolio/tools`): `get_contact_information`, reading public contact settings from environment variables. Background, experience, skills, and project details come from the Notion-generated Markdown knowledge base. Tool inputs are Zod-validated, unknown tools are rejected, execution errors become safe tool results (no stack traces), and tool calls per request are capped by `MAX_TOOL_CALLS`.

## Endpoints

### `GET /health`

Returns `{ "status": "ok" }`. Does not call the model.

### `GET /contact`

Returns the public contact links from `CONTACT_*` env variables (`packages/config/src/contact.ts`), with unset values omitted. No API key required — static public data. A 404 means nothing is configured, and the web sidebar hides the buttons.

### `POST /chat`

Body:

```ts
{
  message: string;          // hard-capped at MAX_MESSAGE_CHARS (8,000)
  sessionId: string;        // client-generated UUID; the server keeps the
                            // transcript and the model's context under it
  attachments?: Array<{ id, name, mimeType, data }>;  // base64; images, text, and bounded PDFs
}
```

Responds as `text/event-stream` (SSE), one JSON object per `data:` frame:

```ts
{ type: "start"; requestId: string; sessionId: string }
{ type: "token"; value: string }
{ type: "tool"; name: string; status: "started" | "completed" }   // name only — never arguments or results
{ type: "thinking"; status: "started" | "stopped" }               // only on models that emit reasoning deltas
{ type: "complete" }
{ type: "error"; code: string; message: string }
```

The conversation lives **server-side** in the configured session store: the client only sends its session id, and the server loads the model-facing history (most recent entries, clamped) and appends each turn — including markers when a turn is stopped or fails. Development uses SQLite; production uses Neon Postgres. Aborted requests also abort the upstream model call.

PDF attachments are limited to 3 MiB and 10 pages each. The browser checks the page limit for user feedback; the API independently validates the PDF in a short-lived worker before storing the turn. PDFs are sent as native file parts to OpenRouter and require `OPENROUTER_MODEL_ID=~openai/gpt-luna-latest`; other configured models receive a clear attachment error. Raw PDF data is not stored in the transcript.

Non-streaming error responses (400 validation, 429 rate limit/concurrency) use the PRD 15.2 envelope: `{ error: { code, message, requestId } }`.

### `GET /admin/overview` and `GET /admin/conversations/:sessionId`

These read-only routes back the dashboard at `/admin`. Local development is bound to loopback. In production, every request must include a valid Cloudflare Access JWT for the configured issuer and audience and match `ADMIN_ACCESS_EMAIL`; missing configuration fails closed with 404. Configure an Access application for the API admin path and an allow policy for your email before enabling the dashboard in Pages.

## Structure

```text
src/
  server.ts            Wiring only: builds dependencies, mounts middleware/handlers
  middleware/cors.ts       CORS headers, reads @portfolio/config's corsConfig
  middleware/apiKey.ts     Checks X-Api-Key against API_KEY if set (no-op if unset)
  middleware/rateLimit.ts  Per-IP fixed-window limiter on POST /chat
  handlers/            Thin HTTP layer: Zod-validate the request, translate
                        service events to SSE via @portfolio/shared's formatSseEvent
    admin.ts              Read-only conversation monitoring endpoints
  middleware/cloudflareAccess.ts  Verifies Cloudflare Access JWTs for admin reads
  services/chatService.ts   Session/request ids, running the agent, recording the
                             turn, complete/error events — knows nothing about HTTP
  agent.ts             Composition root: builds the tool registry, OpenRouter step,
                        and loop deps from @portfolio/agent + @portfolio/tools
  sources.ts           Derives citable sources from the knowledge base's ## headings
  prompt.ts            Builds the system prompt from prompts/system.md + the knowledge base
  sessionStore.ts      SQLite (node:sqlite) adapter for sessions, messages,
                       tool calls, and usage
  postgresStore.ts     Standard PostgreSQL adapter used by production
  migrations/          Versioned PostgreSQL schema migrations
  budget.ts            Daily token budget ledger (SQL-backed; memory variant for tests)
```

## Session storage

Local development defaults to SQLite at `SESSION_DB_PATH` (`./data/sessions.db`, gitignored). Production selects Postgres with `SESSION_STORE=postgres` and the pooled Neon `DATABASE_URL` Fly secret. Message rows are append-only — the full transcript is kept for analytics; compaction (planned) will only add a cached summary + cursor, never rewrite history. Usage rows record tokens per request and back the daily budget circuit breaker, so budgets survive restarts.

## Privacy

What this deployment stores: chat transcripts keyed by a random, client-generated session UUID (the public chat has no account identity), tool-call records, and per-request token-usage rows that include the client IP (used only for abuse budgets). The private admin dashboard uses Cloudflare Access authentication; its cookies are not stored by this app. There is no automated retention yet — transcripts are kept until the operator deletes them, and the chat composer shows a one-line notice telling users that conversations are stored server-side. Keep that notice and this section in sync if storage changes.

## Deployment

The `Dockerfile` at the repo root builds a single portable container (Fly.io today, AWS-mappable later — see `fly.toml` for the current manifest). The full production runbook, including Cloudflare Pages, DNS, environment, and data requirements, is in [`../../docs/deployment.md`](../../docs/deployment.md).

## Environment variables

See the root `.env.example`. `OPENROUTER_API_KEY` is required. `OPENROUTER_MODEL_ID` defaults to `deepseek/deepseek-v4-flash-0731`; `OPENROUTER_SITE_URL` and `OPENROUTER_SITE_NAME` are optional attribution headers. `ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist for browser CORS. `ADMIN_ACCESS_TEAM_DOMAIN`, the API Access application's `ADMIN_ACCESS_AUD`, and `ADMIN_ACCESS_EMAIL` are required to expose production admin data. `PORT`, `SESSION_STORE` (defaults to `sqlite`), `SESSION_DB_PATH` (SQLite only), `DATABASE_URL` (required in Postgres mode), `MAX_AGENT_ITERATIONS` (default 8), `MAX_TOOL_CALLS` (default 12), `MAX_OUTPUT_TOKENS` (default 4096), rate/concurrency/budget limits, and `API_KEY` have working defaults (or are disabled) if unset.

`API_KEY`, if set, requires every `POST /chat` request to send a matching `X-Api-Key` header — this is **not** user authentication (recruiters never sign in), just a deterrent against direct abuse of the endpoint beyond CORS. It's not a real secret once it ships in the web client's built bundle.

Conversation history is capped (most recent 24 entries × 16,000 chars each, clamped server-side). Server-side LLM compaction past a token trigger is planned so the effective window can grow without unbounded cost.

The API supports two `SessionStore` adapters: local SQLite (`SESSION_STORE=sqlite`, the default) and standard PostgreSQL (`SESSION_STORE=postgres`, `DATABASE_URL`). Do not put the production Neon URL in the local `.env`; production receives the pooled runtime URL as a Fly secret. Production releases apply schema migrations using the direct, non-pooled GitHub secret `NEON_MIGRATION_DATABASE_URL`. The one-time SQLite importer requires `SQLITE_DB_PATH`, `DATABASE_URL`, and the explicit confirmation `ALLOW_DATABASE_IMPORT=YES`; it refuses to import into non-empty application tables.
