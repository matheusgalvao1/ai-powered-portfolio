import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSource, ConversationMessage } from "@portfolio/shared";
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

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  status: "pending" | "streaming" | "done" | "error";
  activity?: UiActivity;
  sources?: ChatSource[];
};

const SESSION_STORAGE_KEY = "sessionId";
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

export function useChat() {
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: "",
      status: "streaming",
    },
  ]);
  const [welcomeVersion, setWelcomeVersion] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const sessionIdRef = useRef<string | undefined>(
    localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined,
  );
  const conversationRef = useRef<ConversationMessage[]>([welcomeMessage]);

  const updateMessage = useCallback((id: string, patch: Partial<UiMessage>) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }, []);

  useEffect(() => {
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

  const appendSource = useCallback((id: string, source: ChatSource) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id
          ? { ...message, sources: [...(message.sources ?? []), source] }
          : message,
      ),
    );
  }, []);

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) {
        return;
      }

      const userMessage: UiMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        status: "done",
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

      try {
        const body = ChatRequestSchema.parse({
          message: text,
          sessionId: sessionIdRef.current,
          conversation: conversationRef.current,
        });

        const response = await fetch(`${API_BASE_URL}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(API_KEY ? { "X-Api-Key": API_KEY } : {}),
          },
          body: JSON.stringify(body),
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
              case "source":
                appendSource(assistantId, event.source);
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
        console.error(error);
        updateMessage(assistantId, {
          role: "error",
          status: "error",
          text: UNAVAILABLE_MESSAGE,
          activity: null,
        });
      } finally {
        setIsSending(false);
      }
    },
    [updateMessage, appendSource],
  );

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
  }, []);

  return { messages, sendMessage, isSending, resetConversation };
}
