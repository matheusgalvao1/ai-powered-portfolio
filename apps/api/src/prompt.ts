import { readFileSync } from "node:fs";

export function buildSystemPrompt({
  systemPromptPath,
  knowledgeBase,
}: {
  systemPromptPath: string;
  knowledgeBase: string;
}): string {
  const template = readFileSync(systemPromptPath, "utf8");

  return template.replace("{{KNOWLEDGE_BASE}}", knowledgeBase.trim());
}
