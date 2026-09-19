import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ApiError, ChatStreamEvent } from "@portfolio/shared";
import { ChatErrorCode, ChatRequestSchema, formatSseEvent } from "@portfolio/shared";
import type { ChatService } from "../services/chatService.js";

export function createChatHandler({ chatService }: { chatService: ChatService }) {
  return async function chatHandler(req: Request, res: Response): Promise<void> {
    const result = ChatRequestSchema.safeParse(req.body);

    if (!result.success) {
      const body: ApiError = {
        error: {
          code: ChatErrorCode.VALIDATION_ERROR,
          message: "message is required",
          requestId: randomUUID(),
        },
      };
      res.status(400).json(body);
      return;
    }

    const { message, sessionId, conversation, attachments } = result.data;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // A client disconnect (stop button or navigation) aborts the upstream
    // model call so the generation stops instead of running to completion
    // into a dead socket.
    const abortController = new AbortController();
    res.on("close", () => abortController.abort());

    const emit = (event: ChatStreamEvent) => {
      res.write(formatSseEvent(event));
    };

    await chatService.streamChat(
      {
        message,
        sessionId,
        conversation,
        attachments,
        signal: abortController.signal,
      },
      emit,
    );

    res.end();
  };
}
