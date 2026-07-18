# @portfolio/web

A Vite + React + TypeScript client used to exercise the API while it's being
built. This is **not** the real portfolio frontend — that will be a
static-exported Next.js app, per the project's roadmap. This one exists to test
streaming chat end to end with a real component/hook structure, without
committing to Next.js conventions yet.

## Running

From the repo root:

```bash
pnpm --filter @portfolio/web dev
```

or `pnpm start:web` / `pnpm dev` (both apps). Runs on `http://localhost:3000`
(pinned in `vite.config.ts` to match the API's default `ALLOWED_ORIGIN`).

Other commands: `pnpm --filter @portfolio/web build` (production build),
`pnpm --filter @portfolio/web typecheck` (`tsc -b --noEmit`), `pnpm --filter
@portfolio/web test` (vitest).

## Structure

```text
src/
  main.tsx                 Entry point, imports styles.css
  App.tsx                   Header (brand/tagline) + <ChatPanel/>
  styles.css                 Dark theme, copied verbatim from the previous
                              vanilla client — same class names/data-label
                              attribute the CSS depends on
  components/
    ChatPanel.tsx             Message list + empty-state + composer
    Message.tsx                One message bubble; the only place
                                dangerouslySetInnerHTML appears, and only ever
                                with lib/markdown.ts's escaped output
    Composer.tsx                Input + send button
  hooks/
    useChat.ts                  sessionId (localStorage) + conversation state,
                                 owns the SSE read loop, validates every frame
                                 against @portfolio/shared's ChatStreamEventSchema
  lib/
    markdown.ts                  Markdown -> HTML renderer: escapes HTML first,
                                  so model output can never inject real markup
    markdown.test.ts              Asserts that property — the one test in this
                                   app worth treating as load-bearing
    apiConfig.ts                   Resolves API_BASE_URL from VITE_API_BASE_URL
```

`sessionId`/`conversation` are still owned entirely by the client and sent with
every request — the API is stateless and never persists them.

## Configuration

`VITE_API_BASE_URL` (see `.env.example`) — defaults to `http://localhost:3001`
if unset, same as before, but now overridable per PRD's "explicit
configuration" preference.
