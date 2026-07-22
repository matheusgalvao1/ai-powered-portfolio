import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createPortfolioAgent } from "./agent.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadPortfolioData } from "./portfolio.js";
import { extractKnowledgeSources } from "./sources.js";
import { SessionRecorder } from "./sessionRecorder.js";
import { createChatService } from "./services/chatService.js";
import { healthHandler } from "./handlers/health.js";
import { createChatHandler } from "./handlers/chat.js";
import { corsMiddleware } from "./middleware/cors.js";
import { apiKeyMiddleware } from "./middleware/apiKey.js";
import { createRateLimitMiddleware } from "./middleware/rateLimit.js";
import { agentConfig, modelConfig, serverConfig } from "@portfolio/config";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRootDir = join(apiDir, "../..");

const knowledgeBase = readFileSync(join(repoRootDir, "knowledge/knowledge-base.md"), "utf8");

const systemPrompt = buildSystemPrompt({
  systemPromptPath: join(apiDir, "prompts/system.md"),
  knowledgeBase,
});

const portfolio = loadPortfolioData({
  portfolioPath: join(repoRootDir, "knowledge/portfolio.json"),
  examplePath: join(repoRootDir, "knowledge/portfolio.example.json"),
});

const agent = createPortfolioAgent({
  systemPrompt,
  modelId: modelConfig.modelId,
  region: modelConfig.region,
  maxOutputTokens: modelConfig.maxOutputTokens,
  temperature: modelConfig.temperature,
  maxIterations: agentConfig.maxIterations,
  maxToolCalls: agentConfig.maxToolCalls,
  portfolio,
  validSources: extractKnowledgeSources(knowledgeBase),
});

const recorder = new SessionRecorder({
  sessionsDir: join(apiDir, "data/sessions"),
});
const chatService = createChatService({ agent, recorder });
const rateLimitMiddleware = createRateLimitMiddleware();

const app = express();
app.use(express.json());
app.use(corsMiddleware);

app.get("/health", healthHandler);
app.post(
  "/chat",
  apiKeyMiddleware,
  rateLimitMiddleware,
  createChatHandler({ chatService }),
);

app.listen(serverConfig.port, () => {
  console.log(`API listening on http://localhost:${serverConfig.port}`);
});
