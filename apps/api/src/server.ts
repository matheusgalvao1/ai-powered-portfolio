import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Agent } from "./agent.js";
import { buildSystemPrompt } from "./prompt.js";
import { SessionRecorder } from "./sessionRecorder.js";
import { createChatService } from "./services/chatService.js";
import { healthHandler } from "./handlers/health.js";
import { createChatHandler } from "./handlers/chat.js";
import { corsMiddleware } from "./middleware/cors.js";
import { modelConfig, serverConfig } from "@portfolio/config";

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRootDir = join(apiDir, "../..");

const systemPrompt = buildSystemPrompt({
  systemPromptPath: join(apiDir, "prompts/system.md"),
  knowledgeBasePath: join(repoRootDir, "knowledge/knowledge-base.md"),
});

const agent = new Agent({ systemPrompt, model: modelConfig.model });
const recorder = new SessionRecorder({
  sessionsDir: join(apiDir, "data/sessions"),
});
const chatService = createChatService({ agent, recorder });

const app = express();
app.use(express.json());
app.use(corsMiddleware);

app.get("/health", healthHandler);
app.post("/chat", createChatHandler({ chatService }));

app.listen(serverConfig.port, () => {
  console.log(`API listening on http://localhost:${serverConfig.port}`);
});
