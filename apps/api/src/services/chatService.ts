import { randomUUID } from "node:crypto";
import type { ChatStreamEvent, ConversationMessage } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import { createSessionId } from "../session.js";
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
        const result = await agent.send(
          message,
          { conversation },
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
