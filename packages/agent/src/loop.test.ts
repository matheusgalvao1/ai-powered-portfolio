import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "@portfolio/shared";
import type { ToolRegistry } from "@portfolio/tools";
import { createInitialState, runAgentLoop } from "./loop.js";
import type { AgentLoopDeps, StepResult } from "./types.js";

const VALID_SOURCES = [
  { id: "experience", title: "Experience" },
  { id: "skills", title: "Skills & Specialties" },
];

function fakeRegistry(
  execute: ToolRegistry["execute"] = async () => ({ ok: true, result: { data: 1 } }),
): ToolRegistry {
  return { specs: () => [], execute };
}

function makeDeps(
  steps: StepResult[],
  overrides: Partial<AgentLoopDeps> = {},
): { deps: AgentLoopDeps; events: ChatStreamEvent[]; prompts: string[] } {
  const events: ChatStreamEvent[] = [];
  const prompts: string[] = [];
  let index = 0;

  const deps: AgentLoopDeps = {
    step: async ({ prompt, onToken }) => {
      prompts.push(prompt);
      const result = steps[index] ?? { text: "", toolUses: [] };
      index += 1;
      if (result.text) {
        onToken(result.text);
      }
      return result;
    },
    tools: fakeRegistry(),
    validSources: VALID_SOURCES,
    maxIterations: 5,
    maxToolCalls: 8,
    ...overrides,
  };

  return { deps, events, prompts };
}

const emitInto = (events: ChatStreamEvent[]) => (event: ChatStreamEvent) => events.push(event);

describe("runAgentLoop", () => {
  it("completes when the response carries a final_answer call, emitting validated sources", async () => {
    const { deps, events } = makeDeps([
      {
        text: "He works at CodeSignal.",
        toolUses: [
          {
            toolUseId: "t1",
            name: "final_answer",
            input: { sources: [{ title: "Experience" }, { title: "Unknown Section" }] },
          },
        ],
      },
    ]);

    const state = await runAgentLoop(createInitialState("Where does he work?", []), deps, emitInto(events));

    expect(state.status).toBe("complete");
    expect(state.answer).toBe("He works at CodeSignal.");
    expect(state.truncated).toBe(false);
    const sources = events.filter((event) => event.type === "source");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ source: { id: "experience", title: "Experience" } });
  });

  it("nudges on a response with neither tool calls nor final_answer, then completes", async () => {
    const { deps, events, prompts } = makeDeps([
      { text: "Here is a half answer with no protocol signal", toolUses: [] },
      { text: "Full answer.", toolUses: [{ toolUseId: "t1", name: "final_answer", input: { sources: [] } }] },
    ]);

    const state = await runAgentLoop(createInitialState("Question?", []), deps, emitInto(events));

    expect(state.status).toBe("complete");
    expect(state.steps).toBe(2);
    expect(state.context.some((event) => event.kind === "nudge")).toBe(true);
    expect(prompts[1]).toContain("previous response ended without any tool call");
  });

  it("returns max_steps after the iteration cap, never a half answer presented as final", async () => {
    const violating: StepResult = { text: "rambling", toolUses: [] };
    const { deps, events } = makeDeps([violating, violating, violating], { maxIterations: 3 });

    const state = await runAgentLoop(createInitialState("Question?", []), deps, emitInto(events));

    expect(state.status).toBe("max_steps");
    expect(state.steps).toBe(3);
    expect(state.answer).toBe("");
  });

  it("executes tool calls, records results in the context, and emits name-only tool events", async () => {
    const { deps, events } = makeDeps([
      {
        text: "Let me check the project list.",
        toolUses: [{ toolUseId: "t1", name: "list_projects", input: { skill: "typescript" } }],
      },
      { text: "Done.", toolUses: [{ toolUseId: "t2", name: "final_answer", input: { sources: [] } }] },
    ]);

    const state = await runAgentLoop(createInitialState("TS projects?", []), deps, emitInto(events));

    expect(state.status).toBe("complete");
    expect(state.toolCallsUsed).toBe(1);
    expect(state.context.filter((event) => event.kind === "tool_result")).toHaveLength(1);
    const toolEvents = events.filter((event) => event.type === "tool");
    expect(toolEvents).toEqual([
      { type: "tool", name: "list_projects", status: "started" },
      { type: "tool", name: "list_projects", status: "completed" },
    ]);
  });

  it("records tool failures as tool results without throwing", async () => {
    const { deps, events } = makeDeps([
      { text: "", toolUses: [{ toolUseId: "t1", name: "broken_tool", input: {} }] },
      { text: "Answer anyway.", toolUses: [{ toolUseId: "t2", name: "final_answer", input: { sources: [] } }] },
    ]);
    deps.tools = fakeRegistry(async () => ({ ok: false, error: "Unknown tool: broken_tool" }));

    const state = await runAgentLoop(createInitialState("Q?", []), deps, emitInto(events));

    expect(state.status).toBe("complete");
    const failure = state.context.find((event) => event.kind === "tool_result");
    expect(failure).toMatchObject({ ok: false });
    expect(JSON.stringify(failure)).toContain("Unknown tool");
  });

  it("stops executing tools past the per-request budget and tells the model to finish", async () => {
    const call = (id: string) => ({ toolUseId: id, name: "list_projects", input: {} });
    const { deps } = makeDeps([
      { text: "", toolUses: [call("t1"), call("t2"), call("t3")] },
      { text: "Answer.", toolUses: [{ toolUseId: "t4", name: "final_answer", input: { sources: [] } }] },
    ]);
    deps.maxToolCalls = 2;

    const state = await runAgentLoop(createInitialState("Q?", []), deps, () => {});

    expect(state.toolCallsUsed).toBe(2);
    const budgetNote = state.context.filter(
      (event) => event.kind === "tool_result" && !event.ok && event.content.includes("budget"),
    );
    expect(budgetNote).toHaveLength(1);
  });

  it("completes with the partial text when max_tokens truncates a response without final_answer", async () => {
    const { deps } = makeDeps([
      { text: "A very long answer that got cut o", toolUses: [], stopReason: "max_tokens" },
    ]);

    const state = await runAgentLoop(createInitialState("Long question?", []), deps, () => {});

    expect(state.status).toBe("complete");
    expect(state.truncated).toBe(true);
    expect(state.answer).toBe("A very long answer that got cut o");
    expect(state.steps).toBe(1);
  });

  it("serializes prior conversation into the owned single-turn prompt", async () => {
    const { deps, prompts } = makeDeps([
      { text: "Answer.", toolUses: [{ toolUseId: "t1", name: "final_answer", input: { sources: [] } }] },
    ]);

    await runAgentLoop(
      createInitialState("Follow-up?", [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
      ]),
      deps,
      () => {},
    );

    expect(prompts[0]).toContain("<conversation_history>");
    expect(prompts[0]).toContain("User: First question");
    expect(prompts[0]).toContain("<current_request>\nFollow-up?\n</current_request>");
  });
});
