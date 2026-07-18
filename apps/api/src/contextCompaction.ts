import type { ConversationMessage } from "@portfolio/shared";

// No tokenizer dependency for GLM-5 exists yet, so this is a rough
// characters-per-token heuristic — imprecise but cheap, and good enough to
// bound cost/latency growth. Swap for a real token count if it ever matters
// enough to justify a dependency.
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

// Drops the oldest messages once the estimated total exceeds maxTokens, so
// the client naturally inherits the trimmed history via the "complete"
// event's conversation field on its next turn — no separate client-side
// trimming needed.
export function trimConversation(
  conversation: ConversationMessage[],
  maxTokens: number,
): ConversationMessage[] {
  let total = conversation.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );

  if (total <= maxTokens) {
    return conversation;
  }

  const trimmed = [...conversation];
  while (trimmed.length > 0 && total > maxTokens) {
    const removed = trimmed.shift();
    if (!removed) {
      break;
    }
    total -= estimateTokens(removed.content);
  }

  return trimmed;
}
