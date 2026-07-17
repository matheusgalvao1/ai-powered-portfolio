import { randomUUID } from "node:crypto";
import { createSessionId } from "../session.js";

export function createChatService({ agent, recorder }) {
  return {
    async streamChat({ message, sessionId, conversation = [] }, emit) {
      // The client owns and sends its own sessionId and conversation history;
      // this service never looks either up, it only reads what was sent.
      const activeSessionId = sessionId || createSessionId();
      const requestId = randomUUID();

      emit({ type: "start", requestId, sessionId: activeSessionId });

      try {
        const result = await agent.send(message, { conversation }, (value) => {
          emit({ type: "token", value });
        });

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
          code: "MODEL_ERROR",
          message: "Something went wrong. Please try again.",
        });
      }
    },
  };
}
