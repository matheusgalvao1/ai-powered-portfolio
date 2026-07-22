import { z } from "zod";

// The wire contract between apps/api and apps/web. Extended only when the
// corresponding server behavior actually exists — no speculative events.

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

// A citation to a knowledge-base section, carried by the final_answer
// control tool and validated server-side against known sections before it
// is ever emitted.
export const ChatSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  section: z.string().optional(),
});
export type ChatSource = z.infer<typeof ChatSourceSchema>;

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
  // Tool activity carries the name and lifecycle only — never arguments or
  // results, by design.
  z.object({
    type: z.literal("tool"),
    name: z.string(),
    status: z.enum(["started", "completed"]),
  }),
  // Signals that the model is reasoning, without the reasoning content
  // itself. Only fires on models that emit reasoning deltas via Bedrock
  // Converse (zai.glm-5 does not, verified empirically — wired so a future
  // model switch lights this up without a contract change).
  z.object({
    type: z.literal("thinking"),
    status: z.enum(["started", "stopped"]),
  }),
  z.object({
    type: z.literal("source"),
    source: ChatSourceSchema,
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
