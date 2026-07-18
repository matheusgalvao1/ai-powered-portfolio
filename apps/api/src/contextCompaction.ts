import type { ConversationMessage } from "@portfolio/shared";
import type { Agent } from "./agent.js";

// No tokenizer dependency for GLM-5 exists yet, so this is a rough
// characters-per-token heuristic — imprecise but cheap.
const CHARS_PER_TOKEN_ESTIMATE = 4;
const KEEP_RECENT_MESSAGES = 4;

const SUMMARIZE_INSTRUCTION =
  "For internal conversation-management purposes (not shown to the user), " +
  "summarize the conversation so far in 2-4 concise sentences, preserving " +
  "any names, facts, or open questions still needed to continue it " +
  "naturally. Reply with only the summary text, no preamble.";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function estimateConversationTokens(conversation: ConversationMessage[]): number {
  return conversation.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

// Hard, synchronous safety cap used for the CURRENT turn's answer-generation
// call — cheap, deterministic, no dependency on a second model call
// succeeding. This is the real security/cost boundary (a client could
// otherwise force an arbitrarily expensive single request); the LLM-based
// compaction below is a background quality improvement layered on top of
// it, not a replacement for it.
export function trimConversation(
  conversation: ConversationMessage[],
  maxTokens: number,
): ConversationMessage[] {
  let total = estimateConversationTokens(conversation);
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

// Runs concurrently with the current turn's answer generation (call this
// alongside agent.send via Promise.all, never awaited on its own first) —
// it must never add latency to the response the user is waiting for. Its
// result becomes the conversation history for the *next* turn, not this
// one. Falls back to the cheap synchronous trim above if the summarization
// call itself fails, so a flaky/refusing model response never breaks the
// conversation.
export async function compactConversationInBackground(
  conversation: ConversationMessage[],
  maxTokens: number,
  agent: Agent,
): Promise<ConversationMessage[]> {
  if (estimateConversationTokens(conversation) <= maxTokens) {
    return conversation;
  }

  const recent = conversation.slice(-KEEP_RECENT_MESSAGES);
  const older = conversation.slice(0, -KEEP_RECENT_MESSAGES);

  if (older.length === 0) {
    return trimConversation(conversation, maxTokens);
  }

  try {
    const { answer } = await agent.send(SUMMARIZE_INSTRUCTION, { conversation: older });
    const summaryMessage: ConversationMessage = {
      role: "assistant",
      content: `Summary of earlier conversation: ${answer}`,
    };
    return [summaryMessage, ...recent];
  } catch (error) {
    console.error("Background context compaction failed, falling back to trim:", error);
    return trimConversation(conversation, maxTokens);
  }
}
