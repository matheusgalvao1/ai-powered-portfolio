import type { ChatSource, ChatStreamEvent, ConversationMessage } from "@portfolio/shared";
import type { ToolRegistry } from "@portfolio/tools";

// The owned context event log (12-factor agents pattern): every step, this
// log — not the provider's native multi-turn message format — is serialized
// into a project-owned prompt template and sent as a single-turn request.
export type ContextEvent =
  | { kind: "user_request"; content: string }
  | { kind: "narration"; content: string }
  | { kind: "tool_call"; name: string; input: unknown }
  | { kind: "tool_result"; name: string; ok: boolean; content: string }
  | { kind: "nudge" };

export type AgentStatus = "running" | "complete" | "max_steps";

// Unified state: one object carries steps, status, the context event log,
// and the final answer. The loop is a reducer over this — state in, state
// out — which is what makes it unit-testable without mocking HTTP.
export type AgentState = {
  status: AgentStatus;
  steps: number;
  toolCallsUsed: number;
  conversation: ConversationMessage[];
  context: ContextEvent[];
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
  prompt: string;
  onToken: (value: string) => void;
  onThinking: (status: "started" | "stopped") => void;
}) => Promise<StepResult>;

export type AgentLoopDeps = {
  step: StepFn;
  tools: ToolRegistry;
  validSources: ChatSource[];
  maxIterations: number;
  maxToolCalls: number;
};

export type EmitFn = (event: ChatStreamEvent) => void;
