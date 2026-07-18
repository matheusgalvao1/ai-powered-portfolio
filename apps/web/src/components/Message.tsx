import { renderMarkdown } from "../lib/markdown.js";
import type { UiMessage } from "../hooks/useChat.js";

const LABELS: Record<UiMessage["role"], string> = {
  user: "You",
  assistant: "Assistant",
  error: "Error",
};

export function Message({ message }: { message: UiMessage }) {
  const { role, text, status } = message;

  if (role === "assistant" && status === "pending") {
    return (
      <div className="message assistant" data-label={LABELS.assistant}>
        <span className="typing">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </div>
    );
  }

  if (role === "assistant") {
    return (
      <div
        className="message assistant"
        data-label={LABELS.assistant}
        // Only ever renderMarkdown(text) here, never raw model text — the
        // escape-then-whitelist-tags safety property lives entirely in
        // lib/markdown.ts.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
    );
  }

  return (
    <div className={`message ${role}`} data-label={LABELS[role]}>
      {text}
    </div>
  );
}
