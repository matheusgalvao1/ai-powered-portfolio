# @portfolio/api

REST API for the portfolio chatbot. Express, plain Node, no framework beyond that.

## Running

From the repo root:

```bash
pnpm --filter @portfolio/api dev
```

or just `pnpm start:api` / `pnpm dev` (both apps) from the root. Listens on
`http://localhost:3001` by default.

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
  server.js            Wiring only: builds dependencies, mounts middleware/handlers
  config/              One file per concern (model, server port, CORS), env-overridable
  middleware/cors.js    CORS headers
  handlers/            Thin HTTP layer: parse request, translate service events to SSE
  services/chatService.js   Actual chat logic (session/request ids, calling the agent,
                             recording the turn) — knows nothing about HTTP
  agent.js             Wraps the OpenAI Responses API (streaming)
  prompt.js            Builds the system prompt from prompts/system.md + the knowledge base
  session.js           Session id generation
  sessionRecorder.js   Appends each turn to data/sessions/<sessionId>.jsonl
```

## Session logs

Every turn is appended to `data/sessions/<sessionId>.jsonl` (gitignored). This is a
local stand-in for what will eventually be a DynamoDB write — it exists so you can
see what's actually being asked, not to serve conversation history back to the model.

## Environment variables

See the root `.env.example`. `CHAT_MODEL`, `PORT`, and `ALLOWED_ORIGIN` all have
working defaults if unset; `OPENAI_API_KEY` is required.
