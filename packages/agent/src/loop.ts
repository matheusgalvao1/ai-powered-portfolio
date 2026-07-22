import type { ChatSource, ConversationMessage } from "@portfolio/shared";
import { FINAL_ANSWER_TOOL_NAME, FinalAnswerInputSchema } from "@portfolio/tools";
import { serializeContext } from "./context.js";
import type { AgentLoopDeps, AgentState, EmitFn } from "./types.js";

export function createInitialState(
  message: string,
  conversation: ConversationMessage[],
): AgentState {
  return {
    status: "running",
    steps: 0,
    toolCallsUsed: 0,
    conversation,
    context: [{ kind: "user_request", content: message }],
    answer: "",
    truncated: false,
  };
}

// Sources are validated leniently and degrade to "no sources" — an invalid
// citation never fails the turn (PRD 9.10).
function emitValidatedSources(input: unknown, validSources: ChatSource[], emit: EmitFn): void {
  const parsed = FinalAnswerInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return;
  }

  const byId = new Map(validSources.map((source) => [source.id.toLowerCase(), source]));
  const byTitle = new Map(validSources.map((source) => [source.title.toLowerCase(), source]));
  const emitted = new Set<string>();

  for (const cited of parsed.data.sources) {
    const match =
      (cited.id ? byId.get(cited.id.toLowerCase()) : undefined) ??
      byTitle.get(cited.title.toLowerCase());
    if (match && !emitted.has(match.id)) {
      emitted.add(match.id);
      emit({ type: "source", source: match });
    }
  }
}

// State-in/state-out reducer over the context event log. A response is
// final if and only if it contains a final_answer call; a response with
// neither tool calls nor final_answer is a protocol violation that gets a
// nudge event, bounded by maxIterations.
export async function runAgentLoop(
  initial: AgentState,
  deps: AgentLoopDeps,
  emit: EmitFn,
): Promise<AgentState> {
  const state: AgentState = { ...initial, context: [...initial.context] };

  while (state.status === "running" && state.steps < deps.maxIterations) {
    state.steps += 1;

    const response = await deps.step({
      prompt: serializeContext(state),
      onToken: (value) => emit({ type: "token", value }),
      onThinking: (status) => emit({ type: "thinking", status }),
    });

    const finalCall = response.toolUses.find((call) => call.name === FINAL_ANSWER_TOOL_NAME);
    if (finalCall) {
      emitValidatedSources(finalCall.input, deps.validSources, emit);
      state.status = "complete";
      state.answer = response.text;
      if (response.stopReason === "max_tokens") {
        state.truncated = true;
        console.warn(`[agent] final answer hit the max_tokens cap at step ${state.steps}`);
      }
      return state;
    }

    if (response.stopReason === "max_tokens") {
      // Truncated mid-answer with no termination signal. Nudging would just
      // retry the same over-long answer into the same cap, so complete with
      // what already streamed and log it loudly instead.
      console.warn(
        `[agent] response truncated by max_tokens at step ${state.steps} without final_answer; completing with partial text`,
      );
      state.status = "complete";
      state.answer = response.text;
      state.truncated = true;
      return state;
    }

    if (response.toolUses.length === 0) {
      state.context.push({ kind: "narration", content: response.text }, { kind: "nudge" });
      continue;
    }

    if (response.text.trim().length > 0) {
      state.context.push({ kind: "narration", content: response.text });
    }

    for (const call of response.toolUses) {
      if (state.toolCallsUsed >= deps.maxToolCalls) {
        state.context.push({
          kind: "tool_result",
          name: call.name,
          ok: false,
          content:
            "Tool call budget for this request is exhausted. Write your final answer now and call final_answer.",
        });
        continue;
      }

      state.toolCallsUsed += 1;
      emit({ type: "tool", name: call.name, status: "started" });
      const outcome = await deps.tools.execute(call.name, call.input);
      state.context.push({ kind: "tool_call", name: call.name, input: call.input });
      state.context.push({
        kind: "tool_result",
        name: call.name,
        ok: outcome.ok,
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
