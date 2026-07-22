import type { ChatSource } from "@portfolio/shared";

// The set of citable sources is derived from the knowledge base's `##`
// headings — the same section labels the model sees inline in its system
// prompt. final_answer citations are validated against this set; anything
// else is dropped (never an error).
export function extractKnowledgeSources(knowledgeBaseMarkdown: string): ChatSource[] {
  const sources: ChatSource[] = [];
  const seen = new Set<string>();

  for (const line of knowledgeBaseMarkdown.split("\n")) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (!match?.[1]) {
      continue;
    }

    const title = match[1];
    const id = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (id && !seen.has(id)) {
      seen.add(id);
      sources.push({ id, title });
    }
  }

  return sources;
}
