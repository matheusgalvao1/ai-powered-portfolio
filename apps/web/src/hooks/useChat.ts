import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAttachment, ConversationMessage } from "@portfolio/shared";
import {
  ChatRequestSchema,
  ChatStreamEventSchema,
  parseSseFrames,
} from "@portfolio/shared";
import { API_BASE_URL, API_KEY } from "../lib/apiConfig.js";

// What the assistant is visibly doing while a turn is in flight — shown as
// a label next to the thinking orb, never the underlying content (no
// reasoning tokens, no tool arguments or results).
export type UiActivity = { kind: "thinking" | "tool"; label: string } | null;

// Attachments keep their dataUrl only for the live session so previews render;
// persistence strips it to stay within the localStorage quota.
export type UiMessageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "error" | "interrupted";
  text: string;
  status: "pending" | "streaming" | "done" | "error";
  activity?: UiActivity;
  attachments?: UiMessageAttachment[];
};

const SESSION_STORAGE_KEY = "sessionId";
const CONVERSATION_STORAGE_KEY = "conversation";
const UNAVAILABLE_MESSAGE =
  "The chatbot is temporarily unavailable. Please try again.";
const STREAM_CHARACTER_DELAY_MS = 4;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const WELCOME_MESSAGE =
  "Hi! I'm Matheus's portfolio assistant. Ask me about his experience, " +
  "skills, projects, or how to get in touch — I'll answer from his " +
  "knowledge base, not guesses.";

const welcomeMessage: ConversationMessage = {
  role: "assistant",
  content: WELCOME_MESSAGE,
};

const TOOL_LABELS: Record<string, string> = {
  list_projects: "Checking the project list",
  get_contact_information: "Looking up contact info",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Using ${name}`;
}

type PersistedConversation = {
  messages: UiMessage[];
  conversation: ConversationMessage[];
};

// A turn is only durable once every message in it finished. If the page dies
// mid-stream, the trailing turn is dropped here so what the user sees after a
// reload matches exactly what the model will remember.
function trimIncompleteTurn(messages: UiMessage[]): UiMessage[] {
  let inFlightIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && (message.status === "pending" || message.status === "streaming")) {
      inFlightIndex = i;
      break;
    }
  }

  if (inFlightIndex === -1) {
    return messages;
  }

  for (let i = inFlightIndex; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return messages.slice(0, i);
    }
  }

  return [];
}

function loadPersistedConversation(): PersistedConversation | null {
  try {
    const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as PersistedConversation).messages) ||
      !Array.isArray((parsed as PersistedConversation).conversation)
    ) {
      return null;
    }

    const { messages, conversation } = parsed as PersistedConversation;
    const finishedMessages = messages.filter(
      (message) => message.status === "done" || message.status === "error",
    );
    if (finishedMessages.length === 0) {
      return null;
    }

    return {
      messages: finishedMessages.map((message) => ({
        ...message,
        activity: null,
      })),
      conversation,
    };
  } catch {
    return null;
  }
}

export function useChat() {
  const [restored] = useState(loadPersistedConversation);
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    restored
      ? restored.messages
      : [
          {
            id: "welcome",
            role: "assistant",
            text: "",
            status: "streaming",
          },
        ],
  );
  const [welcomeVersion, setWelcomeVersion] = useState(restored ? 1 : 0);
  const [isSending, setIsSending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | undefined>(
    localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined,
  );
  const conversationRef = useRef<ConversationMessage[]>(
    restored ? restored.conversation : [welcomeMessage],
  );

  const updateMessage = useCallback((id: string, patch: Partial<UiMessage>) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }, []);

  useEffect(() => {
    const welcomeIsAlreadyTyped = messages.some(
      (message) =>
        message.id === "welcome" &&
        message.text === WELCOME_MESSAGE &&
        message.status === "done",
    );
    if (welcomeIsAlreadyTyped) {
      return;
    }

    let characterIndex = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const typeNextCharacter = () => {
      characterIndex += 1;
      const complete = characterIndex >= WELCOME_MESSAGE.length;

      setMessages((prev) =>
        prev.map((message) =>
          message.id === "welcome"
            ? {
                ...message,
                text: WELCOME_MESSAGE.slice(0, characterIndex),
                status: complete ? "done" : "streaming",
              }
            : message,
        ),
      );

      if (!complete) {
        timer = setTimeout(typeNextCharacter, 15);
      }
    };

    timer = setTimeout(typeNextCharacter, 15);
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [welcomeVersion]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CONVERSATION_STORAGE_KEY,
        JSON.stringify({
          messages: trimIncompleteTurn(messages).map((message) =>
            message.attachments
              ? {
                  ...message,
                  attachments: message.attachments.map(({ id, name, mimeType }) => ({
                    id,
                    name,
                    mimeType,
                  })),
                }
              : message,
          ),
          conversation: conversationRef.current,
        }),
      );
    } catch (error) {
      console.error(error);
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (raw: string, attachments: ChatAttachment[] = []) => {
      const text = raw.trim();
      if (!text) {
        return;
      }

      const userMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        status: "done",
        attachments: attachments.map(({ id, name, mimeType, data }) => ({
          id,
          name,
          mimeType,
          dataUrl: `data:${mimeType};base64,${data}`,
        })),
      };
      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: UiMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        status: "pending",
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setIsSending(true);

      let assistantText = "";
      let cancelled = false;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const body = ChatRequestSchema.parse({
          message: text,
          sessionId: sessionIdRef.current,
          conversation: conversationRef.current,
          attachments,
        });

        const response = await fetch(`${API_BASE_URL}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(API_KEY ? { "X-Api-Key": API_KEY } : {}),
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { events, remainder } = parseSseFrames(buffer);
          buffer = remainder;

          for (const rawEvent of events) {
            const result = ChatStreamEventSchema.safeParse(rawEvent);
            if (!result.success) {
              continue;
            }

            const event = result.data;
            switch (event.type) {
              case "start":
                sessionIdRef.current = event.sessionId;
                localStorage.setItem(SESSION_STORAGE_KEY, event.sessionId);
                break;
              case "token":
                for (const character of event.value) {
                  assistantText += character;
                  updateMessage(assistantId, {
                    text: assistantText,
                    status: "streaming",
                    activity: null,
                  });
                  await wait(STREAM_CHARACTER_DELAY_MS);
                }
                break;
              case "thinking":
                updateMessage(assistantId, {
                  activity:
                    event.status === "started"
                      ? { kind: "thinking", label: "Thinking" }
                      : null,
                });
                break;
              case "tool":
                updateMessage(assistantId, {
                  activity:
                    event.status === "started"
                      ? { kind: "tool", label: toolLabel(event.name) }
                      : null,
                });
                break;
              case "complete":
                conversationRef.current = event.conversation;
                updateMessage(assistantId, { status: "done", activity: null });
                break;
              case "error":
                updateMessage(assistantId, {
                  role: "error",
                  status: "error",
                  text: event.message,
                  activity: null,
                });
                break;
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          cancelled = true;
        } else {
          console.error(error);
          updateMessage(assistantId, {
            role: "error",
            status: "error",
            text: UNAVAILABLE_MESSAGE,
            activity: null,
          });
        }
      } finally {
        abortControllerRef.current = null;

        if (cancelled) {
          // The user stopped the turn: the partial answer is discarded and
          // replaced by an "Interrupted" divider. The transcript records the
          // question plus a stopped marker, so the next request tells the
          // model the turn was cut off on purpose instead of leaving a
          // dangling question it never answered.
          updateMessage(assistantId, {
            role: "interrupted",
            text: "",
            status: "done",
            activity: null,
          });

          const attachmentNote =
            attachments.length > 0
              ? `\n\n[Attached files: ${attachments
                  .map((attachment) => `${attachment.name} (${attachment.mimeType})`)
                  .join(", ")}]`
              : "";
          conversationRef.current = [
            ...conversationRef.current,
            { role: "user", content: text + attachmentNote },
            {
              role: "assistant",
              content: "[The user stopped this response before it was finished.]",
            },
          ];
        }

        setIsSending(false);
      }
    },
    [updateMessage],
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const resetConversation = useCallback(() => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: "",
        status: "streaming",
      },
    ]);
    conversationRef.current = [welcomeMessage];
    setWelcomeVersion((version) => version + 1);
    sessionIdRef.current = undefined;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  }, []);

  return { messages, sendMessage, isSending, stop, resetConversation };
}
