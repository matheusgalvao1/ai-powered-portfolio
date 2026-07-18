import { randomUUID } from "node:crypto";
import type { ChatStreamEvent, ConversationMessage } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import { contextConfig } from "@portfolio/config";
import { createSessionId } from "../session.js";
import { compactConversationInBackground, trimConversation } from "../contextCompaction.js";
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
        // Two independent things run concurrently, both derived from the
        // *incoming* conversation only — neither depends on the other's
        // result, so running them in parallel means the LLM-based
        // compaction never adds latency to the answer the user is waiting
        // for:
        //  1. The real answer, generated from a cheap, synchronously
        //     hard-capped view of the history (the actual cost/latency
        //     safety boundary — a client could otherwise force an
        //     arbitrarily expensive single request).
        //  2. A background LLM call that summarizes the older portion of
        //     the conversation into a compact synthetic message, becoming
        //     the history for the *next* turn (not this one).
        const cappedForThisTurn = trimConversation(
          conversation,
          contextConfig.maxContextTokens,
        );

        const [result, compactedHistory] = await Promise.all([
          agent.send(message, { conversation: cappedForThisTurn }, (value) => {
            emit({ type: "token", value });
          }),
          compactConversationInBackground(
            conversation,
            contextConfig.maxContextTokens,
            agent,
          ),
        ]);

        const finalConversation: ConversationMessage[] = [
          ...compactedHistory,
          { role: "user", content: message },
          { role: "assistant", content: result.answer },
        ];

        recorder.recordTurn(activeSessionId, {
          requestId,
          message,
          answer: result.answer,
        });

        emit({ type: "complete", conversation: finalConversation });
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
