import { randomUUID } from "node:crypto";
import type { ChatAttachment, ChatStreamEvent } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import type { PortfolioAgent } from "../agent.js";
import type { SessionStore } from "../sessionStore.js";
import type { BudgetLedger } from "../budget.js";
import type { UserAttachment } from "@portfolio/agent";

export type ChatService = {
  streamChat(
    input: {
      message: string;
      clientKey: string;
      sessionId: string;
      attachments?: ChatAttachment[];
      signal?: AbortSignal;
    },
    emit: (event: ChatStreamEvent) => void,
  ): Promise<void>;
};

function toUserAttachments(attachments: ChatAttachment[] | undefined): UserAttachment[] {
  return (attachments ?? []).map(({ name, mimeType, data }) => ({ name, mimeType, data }));
}

const BUDGET_EXHAUSTED_MESSAGE =
  "I've reached my daily usage limit, so I can't respond right now. Please come back tomorrow.";

// Markers stored instead of a real answer so the model sees why a turn has
// no reply, mirroring what the client-side transcript used to record.
const INTERRUPTED_MARKER = "[The user stopped this response before it was finished.]";
const FAILED_MARKER = "[The assistant failed to complete this response.]";

export function createChatService({
  agent,
  store,
  ledger,
}: {
  agent: PortfolioAgent;
  store: SessionStore;
  ledger: BudgetLedger;
}): ChatService {
  return {
    // The session lives server-side: history is loaded from the store and
    // every turn is appended to it. The client only ever sends a sessionId.
    async streamChat({ message, clientKey, sessionId, attachments, signal }, emit) {
      const requestId = randomUUID();

      if (!ledger.hasHeadroom(clientKey)) {
        emit({
          type: "error",
          code: ChatErrorCode.BUDGET_EXHAUSTED,
          message: BUDGET_EXHAUSTED_MESSAGE,
        });
        return;
      }

      emit({ type: "start", requestId, sessionId });

      try {
        store.ensureSession(sessionId);
        const history = store.loadRecentMessages(sessionId);

        // Save the question before generating so even an abort/error turn
        // leaves the transcript (and the model's next-turn view) consistent.
        const attachmentNote =
          attachments && attachments.length > 0
            ? `\n\n[Attached files: ${attachments
                .map((attachment) => `${attachment.name} (${attachment.mimeType})`)
                .join(", ")}]`
            : "";
        store.appendMessage(sessionId, "user", message + attachmentNote);

        const result = await agent.run(
          message,
          history,
          toUserAttachments(attachments),
          emit,
          signal,
        );

        // Tokens were billed whether the turn completed, hit the iteration
        // cap, or got truncated — record before any status branch.
        if (result.usage) {
          ledger.record(clientKey, sessionId, result.usage);
        }

        if (result.status !== "complete") {
          // Iteration cap hit: a safe fallback error, never a half answer
          // presented as final (PRD 9.10).
          console.error(
            `[chat] agent hit the iteration cap (status=${result.status}, requestId=${requestId})`,
          );
          store.appendMessage(sessionId, "assistant", FAILED_MARKER);
          emit({
            type: "error",
            code: ChatErrorCode.INTERNAL_ERROR,
            message: "I could not finish processing that question. Please try again.",
          });
          return;
        }

        store.appendMessage(sessionId, "assistant", result.answer);
        emit({ type: "complete" });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // The client cancelled the turn (stop button or navigation). The
          // socket is gone, but the marker keeps the transcript consistent
          // so the next turn tells the model the question was cut off.
          console.warn(`[chat] request ${requestId} aborted; generation cancelled`);
          store.appendMessage(sessionId, "assistant", INTERRUPTED_MARKER);
          return;
        }
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
