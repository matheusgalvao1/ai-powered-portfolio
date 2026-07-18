import { z } from "zod";

// Matches today's actual wire contract exactly — not the PRD's future
// superset. No "tool"/"source" events (no tool-calling agent loop exists
// yet), no message length limits (no hardening pass has been built yet).
// Extend this only when the corresponding server behavior actually exists.

export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, "message is required"),
  sessionId: z.string().optional(),
  conversation: z.array(ConversationMessageSchema).optional().default([]),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    requestId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("token"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("complete"),
    conversation: z.array(ConversationMessageSchema),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
