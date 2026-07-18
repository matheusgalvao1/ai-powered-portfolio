import { useCallback, useRef, useState } from "react";
import type { ConversationMessage } from "@portfolio/shared";
import {
  ChatRequestSchema,
  ChatStreamEventSchema,
  parseSseFrames,
} from "@portfolio/shared";
import { API_BASE_URL, API_KEY } from "../lib/apiConfig.js";

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  status: "pending" | "streaming" | "done" | "error";
};

const SESSION_STORAGE_KEY = "sessionId";
const UNAVAILABLE_MESSAGE =
  "The chatbot is temporarily unavailable. Please try again.";

export function useChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const sessionIdRef = useRef<string | undefined>(
    localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined,
  );
  const conversationRef = useRef<ConversationMessage[]>([]);

  const updateMessage = useCallback((id: string, patch: Partial<UiMessage>) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, ...patch } : message)),
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
                assistantText += event.value;
                updateMessage(assistantId, {
                  text: assistantText,
                  status: "streaming",
                });
                break;
              case "complete":
                conversationRef.current = event.conversation;
                updateMessage(assistantId, { status: "done" });
                break;
              case "error":
                updateMessage(assistantId, {
                  role: "error",
                  status: "error",
                  text: event.message,
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
        });
      } finally {
        setIsSending(false);
      }
    },
    [updateMessage],
  );

  const resetConversation = useCallback(() => {
    setMessages([]);
    conversationRef.current = [];
    sessionIdRef.current = undefined;
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  return { messages, sendMessage, isSending, resetConversation };
}
