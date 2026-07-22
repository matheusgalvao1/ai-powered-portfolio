import { randomUUID } from "node:crypto";
import type { ChatStreamEvent, ConversationMessage } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import { createSessionId } from "../session.js";
import type { PortfolioAgent } from "../agent.js";
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
  agent: PortfolioAgent;
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
        const result = await agent.run(message, conversation, emit);

        if (result.status !== "complete") {
          // Iteration cap hit: a safe fallback error, never a half answer
          // presented as final (PRD 9.10).
          console.error(
            `[chat] agent hit the iteration cap (status=${result.status}, requestId=${requestId})`,
          );
          emit({
            type: "error",
            code: ChatErrorCode.INTERNAL_ERROR,
            message: "I could not finish processing that question. Please try again.",
          });
          return;
        }

        recorder.recordTurn(activeSessionId, {
          requestId,
          message,
          answer: result.answer,
        });

        emit({
          type: "complete",
          conversation: [
            ...conversation,
            { role: "user", content: message },
            { role: "assistant", content: result.answer },
          ],
        });
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
