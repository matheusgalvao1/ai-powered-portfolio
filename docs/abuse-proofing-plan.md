# Abuse-Protection Plan

**Current priority:** UI polishing. The baseline abuse protections below are
deployed. Follow-up hardening is intentionally deferred until UI polishing is
complete; this plan records it for later, not as a launch blocker.

## Threat Model

The likely threats for a public portfolio chat are automated request floods,
LLM-cost spikes, resource exhaustion, and prompt injection. Treat the browser
API key as public if enabled: it is bundled into the frontend and is only an
abuse deterrent, not authentication. CORS limits browser origins; it does not
stop curl or other non-browser clients.

## Deployed Baseline

- **Request size:** new message max 8,000 characters. `/chat` JSON body max 20
  MB to allow inline images and PDFs; API-key, rate-limit, and concurrency
  checks run before body parsing.
- **Attachments:** up to four files, each max 3 MiB; text attachments max 128
  KiB combined. PDFs are accepted only with the native-PDF-capable
  `~openai/gpt-luna-latest` model and are limited to 10 pages each by both the
  browser and an API-side worker. The API does not store PDF bytes.
- **Context:** conversation is server-owned in Neon Postgres in production
  (SQLite locally). The model receives up to the latest 24 messages, each
  clamped to 16,000 characters. The client sends only `sessionId`, message,
  and current attachments.
- **Session integrity:** `sessionId` must be a UUID. Messages, sessions, tool
  call records, and usage are stored in Neon Postgres.
- **Request flood controls:** fixed-window limit of 20 requests per IP per 60
  seconds; at most 3 concurrent streams per IP and 20 globally. These counters
  are in-memory and apply to the current single Fly machine.
- **Cost circuit breaker:** OpenRouter usage is recorded in Postgres. The daily
  budget is 200,000 tokens per IP and 1,000,000 tokens globally, resetting at
  UTC midnight. It survives machine restarts. Usage may be under-counted if a
  request is aborted or the provider fails before reporting usage.
- **Agent limits:** 8 iterations, 12 tool calls, and 4,096 output tokens per
  model call.
- **CORS:** exact allowlist for `https://matheusgalvao.com` and
  `https://www.matheusgalvao.com`; unrelated browser origins do not receive an
  allow-origin header.
- **Edge:** Cloudflare proxies the site and API domains. No Cloudflare bot,
  WAF, or edge rate-limit rule has been configured yet.
- **Deployment:** one Fly machine in `iad`, Neon Postgres in `aws-us-east-1`,
  `TRUST_PROXY=2` for the Cloudflare-to-Fly proxy chain. The old SQLite volume
  is detached in `gru` and retained as a rollback copy.
- **API key:** optional `API_KEY` is currently unset. The per-IP/global limits
  and daily budget remain active. If enabled later, remember the matching
  `VITE_API_KEY` is visible in the browser bundle.
- **Retention:** transcripts currently have no automatic expiration or delete
  job; they remain in Neon until manually removed.

The Fly `*.fly.dev` hostname is still directly reachable as well as the
Cloudflare API hostname. Cloudflare edge controls do not apply to direct Fly
requests; the API's own limits and global daily budget are the backstop. Review
proxy/IP handling before relying on edge per-IP rules as the only protection.

## Phase 1: Operational Backstops

Do after UI polishing, before promoting the site widely:

- [ ] Verify OpenRouter auto-top-up is off (if that is the chosen account
  setting), configure spend alerts, and confirm the account credit/spend ceiling.
  OpenRouter is configured, but these specific account safeguards have not
  been verified in this repository.
- [ ] Add a server-side timeout for each OpenRouter call (proposed 60 seconds)
  while preserving client-stop cancellation. Choose the limit with the full
  multi-iteration turn in mind.
- [ ] Set Node request/header timeouts appropriate for SSE streams and slow
  clients; test that normal streamed replies are not cut off.
- [ ] Choose a transcript retention period, disclose it accurately in the UI,
  and implement an SQLite cleanup job. Current behavior is indefinite storage.
- [ ] Decide whether to enable the optional shared API key. It is only a
  low-friction deterrent because visitors can inspect the shipped frontend.

## Phase 2: Edge and Origin Protection

- [ ] Configure Cloudflare bot protections and an edge rate limit for
  `/chat`; consider Turnstile only if scripted abuse warrants the UX friction.
- [ ] Review direct access to `matheus-portfolio-api.fly.dev`. Cloudflare rules
  can be bypassed through that hostname. Consider an origin restriction or a
  trusted-proxy design that validates Cloudflare source IPs before trusting
  forwarded client-IP headers.
- [ ] Exercise IP spoofing, request floods, and concurrency limits against a
  staging or controlled test environment. Confirm the global token budget still
  caps spend if per-IP identification is bypassed.

## Phase 3: Context Growth and More Tools

Do when the knowledge base or tools grow, especially before adding GitHub
repository/readme retrieval:

- [ ] Persist actual tool-call messages/results from the agent loop. The
  Postgres table exists, but the loop does not yet write tool traffic into it.
- [ ] Add server-side context compaction. Estimate the full model input
  (system prompt, history, current message, attachments, and accumulated tool
  results); trigger around 90,000 estimated tokens to leave headroom below a
  100k target.
- [ ] Preserve the raw append-only transcript. Store a compacted summary plus
  a message-sequence cursor; give the model the summary and the most recent
  turns verbatim. Compact again as the cursor advances.
- [ ] Check context size between agent iterations, not just at turn start,
  because tool results accumulate during a turn. Count compaction model usage
  toward the same budget.
- [ ] Store full tool results for later analysis, but never send more than the
  model's remaining context window can accept. If one result alone is too large,
  summarize or select relevant chunks before the next model call; compaction
  cannot make an oversized single request safe retroactively.
- [ ] Cache GitHub/API fetches where freshness permits.
- [x] Add bounded PDF support: require a PDF-capable model, validate the PDF
  and 10-page limit on the server, and cap size and parser concurrency/time.

## Phase 4: Scale and Analytics

- [ ] Keep one Fly machine until rate-limit and concurrency counters move out
  of process memory. Neon makes sessions and budget usage available to multiple
  machines, but the in-memory request/concurrency maps still are not shared.
  Before scaling out or moving to serverless, move those counters to shared
  storage (for example Redis or Durable Objects).
- [ ] Add aggregate recruiter-interest analytics without exposing raw
  transcripts unnecessarily; establish retention/deletion before building an
  admin view.
- [ ] Clean up old usage rows on a separate retention policy. Usage rows are
  intentionally independent of session deletion so deleting a transcript does
  not reset that day's budget.

## Verification Checklist

When continuing this work, verify at least:

- [ ] Oversized message, text attachment, file count, and JSON-body requests
  are rejected before the model is called.
- [ ] Invalid, encrypted, over-size, over-page-limit, or unsupported-model PDF
  requests are rejected before the model is called or a transcript turn is stored.
- [ ] Both production origins pass CORS preflight; an unrelated origin does
  not receive `Access-Control-Allow-Origin`.
- [ ] Rate and concurrency limits return 429 at their configured thresholds.
- [ ] Exceeding either daily token budget blocks further model calls; recorded
  usage survives a Fly restart.
- [ ] Invalid/non-UUID session IDs are rejected; no path-like value reaches
  storage.
- [ ] A client stop aborts generation; upstream timeouts release the stream
  and concurrency slot.
- [ ] Compaction (once implemented) runs before the model context exceeds its
  target, preserves the raw transcript, and includes its own token usage in
  budget accounting.
