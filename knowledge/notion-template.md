# Notion page template

`pnpm sync:notion` reads one Notion page (`NOTION_ROOT_PAGE_ID` in `.env`) and
generates `knowledge/knowledge-base.md` — everything on the page becomes the
knowledge base the agent's answers are grounded in. The file is not committed.

Contact links are **not** part of this page: they are deploy-level config,
read from `CONTACT_*` env variables in `packages/config/src/contact.ts` and
served by `GET /contact`.

## Paste this into the Notion page

Replace the placeholders, then run `pnpm sync:notion`. Markdown pasted into
Notion converts to native blocks.

```markdown
# Your page title

## Summary

One or two paragraphs describing who you are.

## Experience

Roles, dates, what you did. Headings, lists and tables all work.

## Skills & Specialties

- Skill one
- Skill two
```

## Contract rules

- There is no reserved structure: every heading and block on the page is
  knowledge-base content the model is allowed to know. Organize it however
  reads best.
- Headings, lists, quotes and simple tables all convert to markdown tables of
  the same shape in the generated file.
- Content changes require re-running `pnpm sync:notion` (and an API restart
  only if the API isn't already running with `tsx watch`).
