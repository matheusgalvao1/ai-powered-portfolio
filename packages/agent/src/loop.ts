import type { ConversationMessage } from "@portfolio/shared";
import type {
  AgentLoopDeps,
  AgentMessage,
  AgentState,
  EmitFn,
  UserAttachment,
  UserContentPart,
} from "./types.js";

const EMPTY_RESPONSE_NUDGE =
  "System note: your previous response was empty. Respond to the user's request now by " +
  "writing your complete answer as plain text, with no tool calls.";

// Images and PDFs become multimodal content parts (they need a vision- or
// file-capable model); text attachments are inlined into the text part, so
// they work with any model.
function createUserMessage(
  message: string,
  attachments: UserAttachment[],
): AgentMessage {
  if (attachments.length === 0) {
    return { role: "user", content: message };
  }

  const textParts: string[] = [message];
  for (const attachment of attachments) {
    if (attachment.mimeType.startsWith("text/")) {
      const text = Buffer.from(attachment.data, "base64").toString("utf8");
      textParts.push(
        `\n\n[Attached file: ${attachment.name}]\n<attached_file>\n${text}\n</attached_file>`,
      );
    } else if (attachment.mimeType.startsWith("image/")) {
      textParts.push(`\n\n[Attached image: ${attachment.name}]`);
    } else {
      textParts.push(`\n\n[Attached document: ${attachment.name}]`);
    }
  }

  const parts: UserContentPart[] = [{ type: "text", text: textParts.join("") }];
  for (const attachment of attachments) {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
    if (attachment.mimeType.startsWith("image/")) {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    } else if (attachment.mimeType === "application/pdf") {
      parts.push({
        type: "file",
        file: { filename: attachment.name, file_data: dataUrl },
      });
    }
  }

  return { role: "user", content: parts };
}

export function createInitialState(
  message: string,
  conversation: ConversationMessage[],
  attachments: UserAttachment[] = [],
): AgentState {
  return {
    status: "running",
    steps: 0,
    toolCallsUsed: 0,
    messages: [
      ...conversation.map((entry) => ({ role: entry.role, content: entry.content })),
      createUserMessage(message, attachments),
    ],
    answer: "",
    truncated: false,
  };
}

// Classic ReAct loop over the native message array: a response with tool
// calls is executed and the results appended; a response with none IS the
// final answer — the streamed text is what gets delivered (stop reason
// "length" marks it truncated). State in, state out, bounded by
// maxIterations, which is what makes it unit-testable without mocking HTTP.
export async function runAgentLoop(
  initial: AgentState,
  deps: AgentLoopDeps,
  emit: EmitFn,
): Promise<AgentState> {
  const state: AgentState = { ...initial, messages: [...initial.messages] };
  let retriedEmpty = false;

  while (state.status === "running" && state.steps < deps.maxIterations) {
    state.steps += 1;

    const response = await deps.step({
      messages: state.messages,
      signal: deps.signal,
      onToken: (value) => emit({ type: "token", value }),
      onThinking: (status) => emit({ type: "thinking", status }),
    });

    if (response.toolUses.length === 0) {
      if (response.text.trim().length === 0) {
        // An empty response streams nothing the user could keep. Retry once
        // with a nudge instead of ending the turn on silence; two empty
        // responses in a row fail the turn through the max_steps path.
        if (retriedEmpty) {
          console.warn(`[agent] empty response after retry at step ${state.steps}`);
          state.status = "max_steps";
          return state;
        }
        state.messages.push({ role: "system", content: EMPTY_RESPONSE_NUDGE });
        retriedEmpty = true;
        continue;
      }

      state.status = "complete";
      state.answer = response.text;
      if (response.stopReason === "max_tokens") {
        state.truncated = true;
        console.warn(`[agent] answer hit the max_tokens cap at step ${state.steps}`);
      }
      return state;
    }

    state.messages.push({
      role: "assistant",
      content: response.text,
      tool_calls: response.toolUses.map((call) => ({
        id: call.toolUseId,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
      })),
    });

    for (const call of response.toolUses) {
      if (state.toolCallsUsed >= deps.maxToolCalls) {
        state.messages.push({
          role: "tool",
          tool_call_id: call.toolUseId,
          name: call.name,
          content:
            "Tool call budget for this request is exhausted. Write your complete answer now " +
            "as plain text, with no tool calls.",
        });
        continue;
      }

      state.toolCallsUsed += 1;
      emit({ type: "tool", name: call.name, status: "started" });
      const outcome = await deps.tools.execute(call.name, call.input);
      state.messages.push({
        role: "tool",
        tool_call_id: call.toolUseId,
        name: call.name,
        content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
      });
      emit({ type: "tool", name: call.name, status: "completed" });
    }
  }

  if (state.status === "running") {
    state.status = "max_steps";
  }
  return state;
}
