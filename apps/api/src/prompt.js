import { readFileSync } from "node:fs";

export function buildSystemPrompt({ systemPromptPath, knowledgeBasePath }) {
  const template = readFileSync(systemPromptPath, "utf8");
  const knowledgeBase = readFileSync(knowledgeBasePath, "utf8");

  return template.replace("{{KNOWLEDGE_BASE}}", knowledgeBase.trim());
}
