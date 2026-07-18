# AI-Powered Portfolio

A personal portfolio site with an embedded AI chatbot that answers questions about professional background, skills, projects, and experience — grounded in a knowledge base maintained in Notion, not the model's own memory.

TypeScript throughout: a streaming Express API, a Vite + React dev client, and two shared packages for the wire contract and config.

This repo is a pnpm monorepo:

```text
apps/
  api/    REST API — chat endpoint, streaming, session logging
  web/    Vite + React dev client used to exercise the API while the real frontend
          (a static-exported Next.js app) is still being built
packages/
  shared/   Wire-contract types (ChatRequest, ChatStreamEvent), Zod schemas, SSE helpers
  config/   Model/server/CORS configuration, read from env
knowledge/
  knowledge-base.md   Generated locally from Notion — not committed (see below)
scripts/
  sync-notion.ts      Pulls the knowledge base from Notion into knowledge/
```

`apps/api` and `apps/web` each have their own README with details specific to that app.

## Prerequisites

- Node.js 20.12+ (uses the built-in `--env-file-if-exists` flag)
- pnpm

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Used by | Notes |
| --- | --- | --- |
| `AWS_BEARER_TOKEN_BEDROCK` | API | Bedrock API key — picked up automatically by the AWS SDK, no other AWS config needed |
| `BEDROCK_MODEL_ID` | API | Defaults to `zai.glm-5` if unset |
| `BEDROCK_REGION` | API | Defaults to `us-east-1` if unset — must be a region GLM-5 actually supports (no cross-region inference for this model) |
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
pnpm build        # builds the web client (nothing else has a build step yet —
                   # see apps/api/README.md for why)
```

## Knowledge base

The chatbot's knowledge lives in Notion, not in this repo. `knowledge/knowledge-base.md` is generated locally:

```bash
pnpm sync:notion
```

This overwrites `knowledge/knowledge-base.md` from the Notion page referenced by `NOTION_ROOT_PAGE_ID`. The file is gitignored on purpose — it contains real personal content (name, contact info, etc.) synced from Notion, and this repo is meant to be shareable without exposing that. The API reads only this local file; it never calls Notion at request time.

Restart the API after syncing to pick up changes.
