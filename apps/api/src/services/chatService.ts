import { randomUUID } from "node:crypto";
import type { ChatAttachment, ChatStreamEvent, ConversationMessage } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import { createSessionId } from "../session.js";
import type { PortfolioAgent } from "../agent.js";
import type { SessionRecorder } from "../sessionRecorder.js";
import type { UserAttachment } from "@portfolio/agent";

export type ChatService = {
  streamChat(
    input: {
      message: string;
      sessionId?: string;
      conversation?: ConversationMessage[];
      attachments?: ChatAttachment[];
    },
    emit: (event: ChatStreamEvent) => void,
  ): Promise<void>;
};

function toUserAttachments(attachments: ChatAttachment[] | undefined): UserAttachment[] {
  return (attachments ?? []).map(({ name, mimeType, data }) => ({ name, mimeType, data }));
}

export function createChatService({
  agent,
  recorder,
}: {
  agent: PortfolioAgent;
  recorder: SessionRecorder;
}): ChatService {
  return {
    async streamChat({ message, sessionId, conversation = [], attachments }, emit) {
      // The client owns and sends its own sessionId and conversation history;
      // this service never looks either up, it only reads what was sent.
      const activeSessionId = sessionId || createSessionId();
      const requestId = randomUUID();

      emit({ type: "start", requestId, sessionId: activeSessionId });

      try {
        const result = await agent.run(message, conversation, toUserAttachments(attachments), emit);

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

        const attachmentNote =
          attachments && attachments.length > 0
            ? `\n\n[Attached files: ${attachments
                .map((attachment) => `${attachment.name} (${attachment.mimeType})`)
                .join(", ")}]`
            : "";
        emit({
          type: "complete",
          conversation: [
            ...conversation,
            { role: "user", content: message + attachmentNote },
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
