import type { AgentState, ContextEvent } from "./types.js";

const NUDGE_TEXT =
  "System note: your previous response ended without any tool call. " +
  "Either call a data tool to gather information, or finish now by writing your complete answer " +
  "and calling final_answer in the same response.";

function renderEvent(event: ContextEvent): string {
  switch (event.kind) {
    case "user_request":
      return `<current_request>\n${event.content}\n</current_request>`;
    case "narration":
      return `Assistant (earlier this turn): ${event.content}`;
    case "tool_call":
      return `Tool call: ${event.name}(${JSON.stringify(event.input)})`;
    case "tool_result":
      return event.ok
        ? `Tool result (${event.name}): ${event.content}`
        : `Tool error (${event.name}): ${event.content}`;
    case "nudge":
      return NUDGE_TEXT;
  }
}

// The owned context serialization template: prior conversation plus this
// turn's event log, rendered into one single-turn user message.
export function serializeContext(state: Pick<AgentState, "conversation" | "context">): string {
  const parts: string[] = [];

  if (state.conversation.length > 0) {
    const history = state.conversation
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n");
    parts.push(`<conversation_history>\n${history}\n</conversation_history>`);
  }

  for (const event of state.context) {
    parts.push(renderEvent(event));
  }

  parts.push(
    "Respond to the current request now. Write your answer as plain text and call final_answer " +
      "with the knowledge-base section titles that support it.",
  );

  return parts.join("\n\n");
}
