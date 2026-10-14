import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createPortfolioAgent } from "./agent.js";
import { buildSystemPrompt } from "./prompt.js";
import { createSessionStore } from "./sessionStore.js";
import { createPostgresSessionStore } from "./postgresStore.js";
import { createSqlBudgetLedger } from "./budget.js";
import { createChatService } from "./services/chatService.js";
import { healthHandler } from "./handlers/health.js";
import { createChatHandler } from "./handlers/chat.js";
import { createContactHandler } from "./handlers/contact.js";
import { createAdminRouter } from "./handlers/admin.js";
import { createCloudflareAccessMiddleware } from "./middleware/cloudflareAccess.js";
import { corsMiddleware } from "./middleware/cors.js";
import { apiKeyMiddleware } from "./middleware/apiKey.js";
import { createRateLimitMiddleware } from "./middleware/rateLimit.js";
import { createConcurrencyMiddleware } from "./middleware/concurrency.js";
import {
  agentConfig,
  budgetConfig,
  contactConfig,
  modelConfig,
  serverConfig,
} from "@portfolio/config";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRootDir = join(apiDir, "../..");

const knowledgeBase = readFileSync(join(repoRootDir, "knowledge/knowledge-base.md"), "utf8");

const systemPrompt = buildSystemPrompt({
  systemPromptPath: join(apiDir, "prompts/system.md"),
  knowledgeBase,
});

const agent = createPortfolioAgent({
  systemPrompt,
  apiKey: modelConfig.apiKey,
  modelId: modelConfig.modelId,
  siteUrl: modelConfig.siteUrl,
  siteName: modelConfig.siteName,
  maxOutputTokens: modelConfig.maxOutputTokens,
  temperature: modelConfig.temperature,
  maxIterations: agentConfig.maxIterations,
  maxToolCalls: agentConfig.maxToolCalls,
});

function createConfiguredSessionStore() {
  if (serverConfig.sessionStore === "sqlite") {
    return createSessionStore({ dbPath: serverConfig.sessionDbPath });
  }
  if (serverConfig.sessionStore === "postgres") {
    if (!serverConfig.databaseUrl) {
      throw new Error("SESSION_STORE=postgres requires DATABASE_URL");
    }
    return createPostgresSessionStore({ connectionString: serverConfig.databaseUrl });
  }
  throw new Error(`Unsupported SESSION_STORE: ${serverConfig.sessionStore}`);
}

const store = createConfiguredSessionStore();
const ledger = createSqlBudgetLedger({
  store,
  globalDailyTokens: budgetConfig.globalDailyTokens,
  perIpDailyTokens: budgetConfig.perIpDailyTokens,
});
const chatService = createChatService({ agent, store, ledger });
const rateLimitMiddleware = createRateLimitMiddleware();
const concurrencyMiddleware = createConcurrencyMiddleware();

const app = express();
const isProduction = process.env.NODE_ENV === "production";
// TRUST_PROXY must be set in production (behind Cloudflare/nginx) for req.ip
// to be the real client IP — the rate limiter and budget ledger key on it.
if (serverConfig.trustProxy !== undefined) {
  app.set("trust proxy", serverConfig.trustProxy);
}
// Inline base64 attachments: worst case 4 files x 3 MiB raw ~= 16 MiB of JSON.
app.use(express.json({ limit: "20mb" }));
app.use(corsMiddleware);

app.get("/health", healthHandler);
app.get("/contact", createContactHandler({ contact: contactConfig }));
app.use(
  "/admin",
  createAdminRouter({
    store,
    enabled: true,
    authorize: isProduction
      ? createCloudflareAccessMiddleware(serverConfig.adminAccess)
      : undefined,
  }),
);
app.post(
  "/chat",
  apiKeyMiddleware,
  rateLimitMiddleware,
  concurrencyMiddleware,
  createChatHandler({ chatService }),
);

async function startServer(): Promise<void> {
  try {
    // Fail startup rather than reporting healthy while the selected store is
    // unavailable or its Postgres migrations have not been applied.
    await store.usageTokensSince(null, new Date(0).toISOString());
  } catch (error) {
    console.error("Could not connect to the configured session store:", error);
    await store.close();
    process.exitCode = 1;
    return;
  }

  app.listen(serverConfig.port, isProduction ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`API listening on http://localhost:${serverConfig.port}`);
  });
}

void startServer();
