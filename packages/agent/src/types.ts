import type { ChatStreamEvent } from "@portfolio/shared";
import type { ToolRegistry } from "@portfolio/tools";

// A file the user attached to the current request: base64 payload only, no
// client-side id — that never travels past the wire schema.
export type UserAttachment = {
  name: string;
  mimeType: string;
  data: string;
};

// Multimodal content parts for user messages, in the OpenAI-compatible shape
// OpenRouter normalizes across providers. Text attachments do not become
// parts — they are inlined into the text part and work with any model.
export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type ToolCallPayload = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// The native message array sent to the model every step. The loop appends
// the assistant's tool-call messages and the tool results as it runs, so
// each step sees the real conversation shape instead of a serialized prompt.
export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserContentPart[] }
  | { role: "assistant"; content: string; tool_calls?: ToolCallPayload[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export type AgentStatus = "running" | "complete" | "max_steps";

// Unified state: one object carries steps, status, the message array, and
// the final answer. The loop is a reducer over this — state in, state out —
// which is what makes it unit-testable without mocking HTTP.
export type AgentState = {
  status: AgentStatus;
  steps: number;
  toolCallsUsed: number;
  messages: AgentMessage[];
  answer: string;
  // Set when the model hit the output-token cap (stopReason "max_tokens"),
  // so callers can tell a naturally-finished answer from a cut-off one.
  truncated: boolean;
};

export type ToolUseRequest = {
  toolUseId: string;
  name: string;
  input: unknown;
};

export type StepResult = {
  text: string;
  toolUses: ToolUseRequest[];
  stopReason?: string | undefined;
};

// One model invocation. Injected into the loop so tests can drive it with a
// scripted fake; the real implementation streams from OpenRouter.
export type StepFn = (args: {
  messages: AgentMessage[];
  signal?: AbortSignal | undefined;
  onToken: (value: string) => void;
  onThinking: (status: "started" | "stopped") => void;
}) => Promise<StepResult>;

export type AgentLoopDeps = {
  step: StepFn;
  tools: ToolRegistry;
  maxIterations: number;
  maxToolCalls: number;
  // Aborted when the HTTP client for this turn disconnects, so a cancelled
  // generation stops burning tokens upstream instead of running to completion
  // into a closed socket.
  signal?: AbortSignal | undefined;
};

export type EmitFn = (event: ChatStreamEvent) => void;
