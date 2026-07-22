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

    const { message, sessionId, conversation } = result.data;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const emit = (event: ChatStreamEvent) => {
      res.write(formatSseEvent(event));
    };

    await chatService.streamChat({ message, sessionId, conversation }, emit);

    res.end();
  };
}
