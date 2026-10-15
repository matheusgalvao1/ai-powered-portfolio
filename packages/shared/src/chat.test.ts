import { describe, expect, it } from "vitest";
import {
  ChatRequestSchema,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_TEXT_ATTACHMENT_TOTAL_BYTES,
} from "./chat.js";

const VALID_UUID = "7c9e6679-742f-40de-944b-e07fc1f90ae7";

function textAttachment(id: string, decodedBytes: number) {
  const base64Chars = Math.ceil((decodedBytes * 4) / 3 / 4) * 4;
  return {
    id,
    name: `notes-${id}.txt`,
    mimeType: "text/plain",
    data: "A".repeat(base64Chars),
  };
}

describe("ChatRequestSchema", () => {
  it("accepts a message with a session id and default attachments", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual([]);
    }
  });

  it("requires a session id", () => {
    expect(ChatRequestSchema.safeParse({ message: "hi" }).success).toBe(false);
  });

  it("rejects a message over the cap and accepts one at the cap", () => {
    expect(
      ChatRequestSchema.safeParse({
        message: "x".repeat(MAX_MESSAGE_CHARS + 1),
        sessionId: VALID_UUID,
      }).success,
    ).toBe(false);
    expect(
      ChatRequestSchema.safeParse({
        message: "x".repeat(MAX_MESSAGE_CHARS),
        sessionId: VALID_UUID,
      }).success,
    ).toBe(true);
  });

  it("rejects non-UUID sessionIds, including path traversal", () => {
    for (const sessionId of ["../../.env", "not-a-uuid", `${VALID_UUID}x`, ""]) {
      expect(
        ChatRequestSchema.safeParse({ message: "hi", sessionId }).success,
      ).toBe(false);
    }
  });

  it("accepts PDF attachments at the wire layer", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
      attachments: [
        { id: "a1", name: "doc.pdf", mimeType: "application/pdf", data: "aGVsbG8=" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a PDF that exceeds the per-file byte limit", () => {
    const base64Chars = Math.ceil(((MAX_ATTACHMENT_BYTES + 1) * 4) / 3 / 4) * 4;
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
      attachments: [
        {
          id: "a1",
          name: "large.pdf",
          mimeType: "application/pdf",
          data: "A".repeat(base64Chars),
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported document types", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
      attachments: [
        {
          id: "a1",
          name: "doc.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          data: "aGVsbG8=",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects combined text attachments over the total cap", () => {
    const half = MAX_TEXT_ATTACHMENT_TOTAL_BYTES / 2 + 1024;
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
      attachments: [textAttachment("a1", half), textAttachment("a2", half)],
    });
    expect(result.success).toBe(false);
  });

  it("accepts text attachments within the total cap", () => {
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
      attachments: [textAttachment("a1", MAX_TEXT_ATTACHMENT_TOTAL_BYTES / 2)],
    });
    expect(result.success).toBe(true);
  });

  it("keeps the image budget untouched by the text cap", () => {
    const image = {
      id: "i1",
      name: "pic.png",
      mimeType: "image/png",
      // At the per-file limit, well over the combined text cap.
      data: "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3 / 4) * 4),
    };
    expect(
      ChatRequestSchema.safeParse({
        message: "hi",
        sessionId: VALID_UUID,
        attachments: [image],
      }).success,
    ).toBe(true);
  });

  it("still caps the number of files", () => {
    const attachments = Array.from({ length: MAX_ATTACHMENT_FILES + 1 }, (_, index) =>
      textAttachment(`a${index}`, 16),
    );
    const result = ChatRequestSchema.safeParse({
      message: "hi",
      sessionId: VALID_UUID,
      attachments,
    });
    expect(result.success).toBe(false);
  });
});
