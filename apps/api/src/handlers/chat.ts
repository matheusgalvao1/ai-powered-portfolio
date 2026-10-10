import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ApiError, ChatStreamEvent } from "@portfolio/shared";
import {
  ChatErrorCode,
  ChatRequestSchema,
  formatSseEvent,
  MAX_MESSAGE_CHARS,
} from "@portfolio/shared";
import type { ChatService } from "../services/chatService.js";

// Validation failures name the field so clients (and abuse tests) can tell a
// too-long message from a bloated history from a bad sessionId.
function validationError(result: { success: false; error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> } }): ApiError {
  const issue = result.error.issues[0];
  const field = issue?.path[0];
  const tooBig = issue?.code === "too_big";

  let code: ChatErrorCode = ChatErrorCode.VALIDATION_ERROR;
  let message = "message is required";

  if (field === "message") {
    if (tooBig) {
      code = ChatErrorCode.MESSAGE_TOO_LONG;
      message = `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`;
    } else {
      message = "message is required";
    }
  } else if (field === "sessionId") {
    message = "sessionId is required and must be a UUID.";
  } else if (field === "attachments") {
    message = "Attachments are invalid or too large.";
  }

  return {
    error: {
      code,
      message,
      requestId: randomUUID(),
    },
  };
}

export function createChatHandler({ chatService }: { chatService: ChatService }) {
  return async function chatHandler(req: Request, res: Response): Promise<void> {
    const result = ChatRequestSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json(validationError(result));
      return;
    }

    const { message, sessionId, attachments } = result.data;

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
        // The rate limiter and budget ledger key on this — the client IP as
        // resolved through the (optionally proxy-aware) Express settings.
        clientKey: req.ip ?? "unknown",
        sessionId,
        attachments,
        signal: abortController.signal,
      },
      emit,
    );

    res.end();
  };
}
