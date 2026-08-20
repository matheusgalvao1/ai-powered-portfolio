import { ThinkingOrb } from "thinking-orbs";
import { renderMarkdown } from "../lib/markdown.js";
import type { UiMessage } from "../hooks/useChat.js";

function ActivityIndicator({
  label,
  state,
}: {
  label?: string;
  state: "connecting" | "solving";
}) {
  return (
    <span className="message-activity">
      <ThinkingOrb state={state} size={64} aria-label={label ?? state} />
      {label ? <span className="message-activity-label">{label}</span> : null}
    </span>
  );
}

export function Message({
  message,
  isLast,
}: {
  message: UiMessage;
  isLast: boolean;
}) {
  const { role, text, status, activity, sources } = message;

  if (role === "assistant") {
    const busy = status === "pending" || status === "streaming";

    return (
      <div className={`message assistant${isLast ? " last" : ""}`}>
        {isLast ? (
          <ActivityIndicator
            label={busy ? activity?.label : undefined}
            state={busy ? "solving" : "connecting"}
          />
        ) : null}
        <div className="message-content">
          {text ? (
            <div
              className="message-body"
              // Only ever renderMarkdown(text) here, never raw model text — the
              // escape-then-whitelist-tags safety property lives entirely in
              // lib/markdown.ts.
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
            />
          ) : null}
          {status === "done" && sources && sources.length > 0 ? (
            <div className="message-sources">
              Sources: {sources.map((source) => source.title).join(" · ")}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`message ${role}`}>{text}</div>
  );
}
