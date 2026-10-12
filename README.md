# AI-Powered Portfolio

A personal portfolio site with an embedded AI chatbot that answers questions about professional background, skills, projects, and experience — grounded in a knowledge base maintained in Notion, not the model's own memory.

TypeScript throughout: a streaming Express API running a hand-rolled tool-calling agent loop, a chat-first Vite + React frontend, and shared packages for the wire contract, config, agent loop, and tools.

This repo is a pnpm monorepo:

```text
apps/
  api/    REST API — chat endpoint, streaming, session logging
  web/    Vite + React chat-first frontend, deployed as a static site to Cloudflare Pages
packages/
  shared/   Wire-contract types (ChatRequest, ChatStreamEvent), Zod schemas, SSE helpers
  config/   Model/server/CORS/agent-limit configuration, read from env
  agent/    State-reducer agent loop: native multi-turn messages, plain-text
            termination, OpenRouter streaming step
  tools/    Tool registry + the structured portfolio tools (list_projects,
            get_contact_information)
knowledge/
  knowledge-base.md        Generated locally from Notion — not committed (see below)
  notion-template.md       The expected Notion page structure for the sync — follow it
  portfolio.json           Structured data the agent's tools read — not committed
  portfolio.example.json   Committed placeholder to copy from
scripts/
  sync-notion.ts      Pulls the knowledge base from Notion into knowledge/
                      (page structure: knowledge/notion-template.md)
```

`apps/api` and `apps/web` each have their own README with details specific to that app.

## Prerequisites

- Node.js 22.5+ (`node:sqlite` is used by the API session store)
- pnpm

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Used by | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | API | OpenRouter API key |
| `OPENROUTER_MODEL_ID` | API | Defaults to `deepseek/deepseek-v4-flash-0731` if unset |
| `OPENROUTER_SITE_URL` | API | Optional site URL used for OpenRouter attribution |
| `OPENROUTER_SITE_NAME` | API | Optional app name used for OpenRouter attribution |
| `NOTION_API_KEY` | Notion sync | Internal integration secret |
| `NOTION_ROOT_PAGE_ID` | Notion sync | Root page containing the knowledge base |
| `NOTION_PROJECTS_DATABASE_ID` | Notion sync | Not used yet — reserved for a future structured Projects database |

`.env` is gitignored; both apps and scripts read it automatically, no manual `export` needed.

## Running it

```bash
pnpm dev          # API on :3001 and web client on :3000, together
pnpm start:api    # API only
pnpm start:web    # web client only
```

Open `http://localhost:3000` and chat.

## Other commands

```bash
pnpm typecheck    # tsc --noEmit across every package/app
pnpm build        # builds the static web frontend for Cloudflare Pages
```

## Knowledge base

The chatbot's knowledge lives in Notion, not in this repo. `knowledge/knowledge-base.md` is generated locally:

```bash
pnpm sync:notion
```

This overwrites `knowledge/knowledge-base.md` from the Notion page referenced by `NOTION_ROOT_PAGE_ID`. The file is gitignored on purpose because it contains personal content synced from Notion. The API reads this local file at startup; it never calls Notion at request time.

Restart the API after syncing to pick up changes.

## Production Deployment

The production topology, current Cloudflare Pages/Fly settings, DNS, secrets,
deployment commands, and local-only knowledge-file caveats are documented in
[`docs/deployment.md`](docs/deployment.md).
