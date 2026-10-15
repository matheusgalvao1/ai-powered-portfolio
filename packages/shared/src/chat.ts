import { z } from "zod";

// The wire contract between apps/api and apps/web. Extended only when the
// corresponding server behavior actually exists — no speculative events.

// Message caps. MAX_MESSAGE_CHARS is a hard request limit (the client just
// typed it, so rejecting is fine). The history caps apply to what the SERVER
// stores/sends to the model: the conversation lives in the server-side SQLite
// session store (the client only sends a sessionId), and the model sees the
// most recent MAX_HISTORY_MESSAGES entries clamped to MAX_HISTORY_MESSAGE_CHARS
// each — later softened by compaction.
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_HISTORY_MESSAGE_CHARS = 16_000;

// sessionId is generated client-side and becomes the server-side session
// key (SQLite primary key, formerly a filename) — constrained to UUIDs to
// rule out traversal/collision games.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-side history entry shape (not part of the wire request anymore —
// the conversation lives in the session store).
export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// Attachments are base64 payloads sent inline in the request body. Images
// become multimodal content parts; text files are inlined into the prompt and
// work with any model; PDFs are passed to OpenRouter as native file parts and
// are accepted only by a configured PDF-capable model. PDF page count is
// verified on both client and server because byte size alone does not bound
// parsing work or model input cost.
export const MAX_ATTACHMENT_FILES = 4;
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENT_BASE64_CHARS = 4_300_000;
export const MAX_TEXT_ATTACHMENT_TOTAL_BYTES = 128 * 1024;
export const MAX_PDF_PAGES = 10;
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
  message: z.string().trim().min(1, "message is required").max(MAX_MESSAGE_CHARS),
  // Required: the client generates it when a conversation is born and the
  // server keeps the history under this key. UUIDs because it becomes a
  // database key / former filename — rules out path traversal and collisions.
  sessionId: z.string().regex(UUID_PATTERN, "sessionId must be a UUID"),
  attachments: z
    .array(ChatAttachmentSchema)
    .max(MAX_ATTACHMENT_FILES)
    .refine(
      (attachments) =>
        attachments
          .filter((attachment) => attachment.mimeType.startsWith("text/"))
          .reduce((total, attachment) => total + (attachment.data.length * 3) / 4, 0) <=
        MAX_TEXT_ATTACHMENT_TOTAL_BYTES,
      "text attachments are too large",
    )
    .optional()
    .default([]),
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
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
