import { randomUUID } from "node:crypto";
import type { ChatStreamEvent, ConversationMessage } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import { contextConfig } from "@portfolio/config";
import { createSessionId } from "../session.js";
import { trimConversation } from "../contextCompaction.js";
import type { Agent } from "../agent.js";
import type { SessionRecorder } from "../sessionRecorder.js";

export type ChatService = {
  streamChat(
    input: {
      message: string;
      sessionId?: string;
      conversation?: ConversationMessage[];
    },
    emit: (event: ChatStreamEvent) => void,
  ): Promise<void>;
};

export function createChatService({
  agent,
  recorder,
}: {
  agent: Agent;
  recorder: SessionRecorder;
}): ChatService {
  return {
    async streamChat({ message, sessionId, conversation = [] }, emit) {
      // The client owns and sends its own sessionId and conversation history;
      // this service never looks either up, it only reads what was sent.
      const activeSessionId = sessionId || createSessionId();
      const requestId = randomUUID();

      emit({ type: "start", requestId, sessionId: activeSessionId });

      try {
        // Trim before calling the model — this is the security boundary
        // (a client could otherwise send an arbitrarily large payload) and
        // it means the trimmed history is also what comes back in the
        // "complete" event, so the client naturally adopts it as its new
        // conversation for the next turn without any client-side trimming.
        const trimmedConversation = trimConversation(
          conversation,
          contextConfig.maxContextTokens,
        );

        const result = await agent.send(
          message,
          { conversation: trimmedConversation },
          (value) => {
            emit({ type: "token", value });
          },
        );

        recorder.recordTurn(activeSessionId, {
          requestId,
          message,
          answer: result.answer,
        });

        emit({ type: "complete", conversation: result.conversation });
      } catch (error) {
        console.error(error);
        emit({
          type: "error",
          code: ChatErrorCode.MODEL_ERROR,
          message: "Something went wrong. Please try again.",
        });
      }
    },
  };
}
