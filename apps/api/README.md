# @portfolio/api

REST API for the portfolio chatbot. TypeScript, Express, no framework beyond that.
Request/stream types come from `@portfolio/shared`; model/server/CORS config comes
from `@portfolio/config`.

## Running

From the repo root:

```bash
pnpm --filter @portfolio/api dev
```

or just `pnpm start:api` / `pnpm dev` (both apps) from the root. Listens on
`http://localhost:3001` by default. Runs directly via `tsx watch` — no separate
build step, since nothing consumes compiled output yet (no Lambda deployment
exists). `pnpm --filter @portfolio/api typecheck` runs `tsc --noEmit`.

## Endpoints

### `GET /health`

Returns `{ "status": "ok" }`. Does not call the model.

### `POST /chat`

Body:

```ts
{
  message: string;
  sessionId?: string;       // client-generated; the server never creates or looks one up
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}
```

Responds as `text/event-stream` (SSE), one JSON object per `data:` frame:

```ts
{ type: "start"; requestId: string; sessionId: string }
{ type: "token"; value: string }
{ type: "complete"; conversation: Array<{ role: string; content: string }> }
{ type: "error"; code: string; message: string }
```

The client is responsible for keeping `sessionId` and `conversation` across
requests — the API is stateless and never persists conversation state itself.

## Structure

```text
src/
  server.ts            Wiring only: builds dependencies, mounts middleware/handlers
  middleware/cors.ts    CORS headers, reads @portfolio/config's corsConfig
  handlers/            Thin HTTP layer: Zod-validate the request, translate
                        service events to SSE via @portfolio/shared's formatSseEvent
  services/chatService.ts   Actual chat logic (session/request ids, calling the agent,
                             recording the turn) — knows nothing about HTTP
  agent.ts             Wraps the OpenAI Responses API (streaming)
  prompt.ts            Builds the system prompt from prompts/system.md + the knowledge base
  session.ts           Session id generation
  sessionRecorder.ts   Appends each turn to data/sessions/<sessionId>.jsonl
```

Model/server/CORS config lives in `packages/config` (not `src/config/` anymore —
moved there since it's real logic other consumers can now import too). The chat
request/response/event types live in `packages/shared`, imported by both this
app and `apps/web`.

## Session logs

Every turn is appended to `data/sessions/<sessionId>.jsonl` (gitignored). This is a
local stand-in for what will eventually be a DynamoDB write — it exists so you can
see what's actually being asked, not to serve conversation history back to the model.

## Environment variables

See the root `.env.example`. `CHAT_MODEL`, `PORT`, and `ALLOWED_ORIGIN` all have
working defaults if unset; `OPENAI_API_KEY` is required.
