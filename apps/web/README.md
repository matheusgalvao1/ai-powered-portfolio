# @portfolio/web

A deliberately minimal, dependency-free HTML/JS client used to exercise the API
while it's being built. This is **not** the real portfolio frontend — that will be
a static-exported Next.js app, per the project's roadmap. This one exists purely to
test streaming chat end to end without any build tooling in the way.

## Running

From the repo root:

```bash
pnpm --filter @portfolio/web dev
```

or `pnpm start:web` / `pnpm dev` (both apps). Serves `public/` on
`http://localhost:3000` via a small static file server (`server.js`, no dependencies).

## Structure

```text
server.js            Static file server (plain node:http, serves public/)
public/
  index.html          Chat page markup
  app.js              Fetches POST /chat, reads the SSE stream, tracks sessionId +
                      conversation client-side (localStorage / in-memory)
  markdown.js         Small dependency-free markdown -> HTML renderer, escapes
                      HTML first so model output can never inject real markup
  styles.css
```

`app.js` talks to the API at `http://localhost:3001` (hardcoded — this client is
temporary, not worth making configurable yet).
