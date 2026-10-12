# @portfolio/web

A Vite + React + TypeScript chat-first frontend. It is the deployed public site: visitors land on the assistant, with contact links and conversation history in the sidebar. The portfolio can grow beyond the chat later without changing the API deployment.

## Running

From the repo root:

```bash
pnpm --filter @portfolio/web dev
```

or `pnpm start:web` / `pnpm dev` (both apps). Runs on `http://localhost:3000`; this origin is in the API's default local CORS allowlist.

Other commands: `pnpm --filter @portfolio/web build` (production build), `pnpm --filter @portfolio/web typecheck` (`tsc -b --noEmit`), `pnpm --filter @portfolio/web test` (vitest).

## Structure

```text
src/
  main.tsx                 Entry point, imports styles.css
  App.tsx                   Renders the chat-first <ChatPanel/>
  styles.css                 Dark theme, copied verbatim from the previous
                              vanilla client — same class names/data-label
                              attribute the CSS depends on
  components/
    ChatPanel.tsx             Message list + empty-state + composer
    Message.tsx                One message bubble: markdown body, activity
                                indicator (thinking/tool label — never
                                arguments, results, or reasoning content),
                                and a sources footer once done. The only
                                place dangerouslySetInnerHTML appears, and
                                only ever with lib/markdown.ts's escaped output
    Composer.tsx                Input + send button
  hooks/
    useChat.ts                  sessionId (localStorage) + display transcript,
                                 owns the SSE read loop, validates every frame
                                 against @portfolio/shared's ChatStreamEventSchema,
                                 maps tool/thinking/source events to UI state
  lib/
    markdown.ts                  Markdown -> HTML renderer: escapes HTML first,
                                  so model output can never inject real markup
    markdown.test.ts              Asserts that property — the one test in this
                                   app worth treating as load-bearing
    apiConfig.ts                   Resolves API_BASE_URL/API_KEY from
                                    VITE_API_BASE_URL/VITE_API_KEY
```

The client persists display messages locally and sends a `sessionId` with each request. The server owns the model-facing transcript in SQLite; the client does not send conversation history.

## Conversation dashboard

Run `pnpm dev` from the repository root and open `http://localhost:3000/admin` to inspect the local API database (`SESSION_DB_PATH`, default `./data/sessions.db`). In production, `/admin` uses the same page but requires Cloudflare Access; the API independently validates Access JWTs before returning chat data. The local database is separate from the production Fly volume.

## Configuration

`VITE_API_BASE_URL` (see `.env.example`) — defaults to `http://localhost:3001` locally; production uses `https://api.matheusgalvao.com` (Cloudflare Pages build variable).

`VITE_API_KEY` — only needed if the API has `API_KEY` set; sent as `X-Api-Key` on every request. Not a real secret once built into this bundle — see `apps/api/README.md`.

Production Pages settings and domains are documented in [`../../docs/deployment.md`](../../docs/deployment.md).
