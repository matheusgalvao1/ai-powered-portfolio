import { z } from "zod";

// The wire contract between apps/api and apps/web. Extended only when the
// corresponding server behavior actually exists — no speculative events.

export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// Attachments are base64 data URLs sent inline in the request body. Images
// and PDFs become multimodal content parts (they need a vision-capable
// model); text files are inlined into the prompt and work with any model.
export const MAX_ATTACHMENT_FILES = 4;
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENT_BASE64_CHARS = 4_300_000;
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
];

export function isAllowedAttachmentType(mimeType: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType);
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const ChatAttachmentSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().refine(isAllowedAttachmentType, "unsupported attachment type"),
  data: z
    .string()
    .max(MAX_ATTACHMENT_BASE64_CHARS, "attachment is too large")
    .refine(
      (data) => data.length % 4 === 0 && BASE64_PATTERN.test(data),
      "attachment data must be base64",
    )
    .refine(
      (data) => (data.length * 3) / 4 <= MAX_ATTACHMENT_BYTES,
      "attachment is too large",
    ),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, "message is required"),
  sessionId: z.string().optional(),
  conversation: z.array(ConversationMessageSchema).optional().default([]),
  attachments: z.array(ChatAttachmentSchema).max(MAX_ATTACHMENT_FILES).optional().default([]),
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
  // Tool activity carries the name and lifecycle only — never arguments or
  // results, by design.
  z.object({
    type: z.literal("tool"),
    name: z.string(),
    status: z.enum(["started", "completed"]),
  }),
  // Signals that the model is reasoning, without the reasoning content
  // itself. Only fires on models that emit reasoning deltas through the
  // provider adapter; models without reasoning support simply omit it.
  z.object({
    type: z.literal("thinking"),
    status: z.enum(["started", "stopped"]),
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
