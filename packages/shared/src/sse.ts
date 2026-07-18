import type { ChatStreamEvent } from "./chat.js";

export function formatSseEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseSseFrames(buffer: string): {
  events: unknown[];
  remainder: string;
} {
  const frames = buffer.split("\n\n");
  const remainder = frames.pop() ?? "";

  const events = frames
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => JSON.parse(frame.slice("data:".length).trim()));

  return { events, remainder };
}
