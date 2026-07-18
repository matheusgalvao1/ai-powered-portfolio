import type { Request, Response } from "express";
import type { ChatStreamEvent } from "@portfolio/shared";
import { ChatRequestSchema, formatSseEvent } from "@portfolio/shared";
import type { ChatService } from "../services/chatService.js";

export function createChatHandler({ chatService }: { chatService: ChatService }) {
  return async function chatHandler(req: Request, res: Response): Promise<void> {
    const result = ChatRequestSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({ error: "message is required" });
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
