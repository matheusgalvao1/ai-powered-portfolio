import { ThinkingOrb } from "thinking-orbs";
import type { UiMessage } from "../hooks/useChat.js";
import { MarkdownMessage } from "./MarkdownMessage.js";

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
  const { role, text, status, activity } = message;

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
            <MarkdownMessage text={text} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`message ${role}`}>
      {message.attachments && message.attachments.length > 0 ? (
        <div className="message-attachments">
          {message.attachments.map((attachment) =>
            attachment.dataUrl && attachment.mimeType.startsWith("image/") ? (
              <img
                key={attachment.id}
                className="message-attachment-image"
                src={attachment.dataUrl}
                alt={attachment.name}
              />
            ) : (
              <span key={attachment.id} className="message-attachment-chip">
                {attachment.name}
              </span>
            ),
          )}
        </div>
      ) : null}
      {text}
    </div>
  );
}
