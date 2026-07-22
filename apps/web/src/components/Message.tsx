import { renderMarkdown } from "../lib/markdown.js";
import type { UiMessage } from "../hooks/useChat.js";

const LABELS: Record<UiMessage["role"], string> = {
  user: "You",
  assistant: "Assistant",
  error: "Error",
};

function ActivityIndicator({ label }: { label?: string }) {
  return (
    <span className="message-activity">
      <span className="typing">
        <span></span>
        <span></span>
        <span></span>
      </span>
      {label ? <span className="message-activity-label">{label}</span> : null}
    </span>
  );
}

export function Message({ message }: { message: UiMessage }) {
  const { role, text, status, activity, sources } = message;

  if (role === "assistant") {
    const busy = status === "pending" || status === "streaming";

    return (
      <div className="message assistant" data-label={LABELS.assistant}>
        {text ? (
          <div
            className="message-body"
            // Only ever renderMarkdown(text) here, never raw model text — the
            // escape-then-whitelist-tags safety property lives entirely in
            // lib/markdown.ts.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
          />
        ) : null}
        {busy && (activity || !text) ? (
          <ActivityIndicator label={activity?.label} />
        ) : null}
        {status === "done" && sources && sources.length > 0 ? (
          <div className="message-sources">
            Sources: {sources.map((source) => source.title).join(" · ")}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`message ${role}`} data-label={LABELS[role]}>
      {text}
    </div>
  );
}
