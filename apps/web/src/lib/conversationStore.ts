import type { ConversationMessage } from "@portfolio/shared";
import type { UiMessage } from "../hooks/useChat.js";

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: number;
};

export type StoredConversation = {
  id: string;
  title: string;
  sessionId?: string;
  messages: UiMessage[];
  transcript: ConversationMessage[];
};

const INDEX_KEY = "conversations";
const ACTIVE_KEY = "conversation";
const MAX_CONVERSATIONS = 20;

const conversationKey = (id: string) => `conversation:${id}`;

function safeParse(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asStoredConversation(value: unknown): StoredConversation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const parsed = value as Partial<StoredConversation>;
  if (
    !Array.isArray(parsed.messages) ||
    !Array.isArray(parsed.transcript) ||
    typeof parsed.id !== "string" ||
    typeof parsed.title !== "string"
  ) {
    return null;
  }
  return {
    id: parsed.id,
    title: parsed.title,
    sessionId:
      typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
    messages: parsed.messages,
    transcript: parsed.transcript,
  };
}

export function loadIndex(): ConversationSummary[] {
  const parsed = safeParse(localStorage.getItem(INDEX_KEY));
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is ConversationSummary =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ConversationSummary).id === "string" &&
      typeof (entry as ConversationSummary).title === "string",
  );
}

// Most recent first, capped so the index cannot grow forever.
export function upsertIndex(
  summary: Pick<ConversationSummary, "id" | "title">,
): ConversationSummary[] {
  const next = [
    { ...summary, updatedAt: Date.now() },
    ...loadIndex().filter((entry) => entry.id !== summary.id),
  ].slice(0, MAX_CONVERSATIONS);
  localStorage.setItem(INDEX_KEY, JSON.stringify(next));
  return next;
}

export function loadConversation(id: string): StoredConversation | null {
  const stored = asStoredConversation(safeParse(localStorage.getItem(conversationKey(id))));
  if (!stored || stored.messages.length === 0) {
    return null;
  }
  return stored;
}

export function saveConversation(entry: StoredConversation): void {
  localStorage.setItem(conversationKey(entry.id), JSON.stringify(entry));
}

// The active pointer keeps the exact on-screen state (including "nothing
// active" after New chat) restorable on refresh.
export function loadActive(): StoredConversation | null {
  const parsed = safeParse(localStorage.getItem(ACTIVE_KEY)) as
    | (Partial<StoredConversation> & { messages?: unknown; conversation?: unknown })
    | null;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray(parsed.messages) ||
    !Array.isArray(parsed.conversation)
  ) {
    return null;
  }

  // Legacy payloads (single-conversation era) have no id/title; adopt them
  // instead of dropping the user's current chat on upgrade.
  const stored: StoredConversation = {
    id: typeof parsed.id === "string" ? parsed.id : crypto.randomUUID(),
    title:
      typeof parsed.title === "string" && parsed.title
        ? parsed.title
        : "Previous conversation",
    sessionId:
      typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
    messages: parsed.messages,
    transcript: parsed.conversation as ConversationMessage[],
  };

  if (stored.messages.length === 0) {
    return null;
  }
  return stored;
}

export function saveActive(entry: StoredConversation): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(entry));
  saveConversation(entry);
}

export function clearActive(): void {
  localStorage.removeItem(ACTIVE_KEY);
}
