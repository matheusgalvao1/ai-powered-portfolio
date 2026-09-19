import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "@portfolio/shared";
import type { ToolRegistry } from "@portfolio/tools";
import { createInitialState, runAgentLoop } from "./loop.js";
import type { AgentLoopDeps, AgentMessage, StepResult } from "./types.js";

function fakeRegistry(
  execute: ToolRegistry["execute"] = async () => ({ ok: true, result: { data: 1 } }),
): ToolRegistry {
  return { specs: () => [], execute };
}

type StepCall = { messages: AgentMessage[] };

function makeDeps(
  steps: StepResult[],
  overrides: Partial<AgentLoopDeps> = {},
): { deps: AgentLoopDeps; events: ChatStreamEvent[]; calls: StepCall[] } {
  const events: ChatStreamEvent[] = [];
  const calls: StepCall[] = [];
  let index = 0;

  const deps: AgentLoopDeps = {
    step: async ({ messages, onToken }) => {
      calls.push({ messages: structuredClone(messages) });
      const result = steps[index] ?? { text: "", toolUses: [] };
      index += 1;
      if (result.text) {
        onToken(result.text);
      }
      return result;
    },
    tools: fakeRegistry(),
    maxIterations: 5,
    maxToolCalls: 8,
    ...overrides,
  };

  return { deps, events, calls };
}

const emitInto = (events: ChatStreamEvent[]) => (event: ChatStreamEvent) => events.push(event);

const toolCall = (id: string, name = "list_projects", input: unknown = {}) => ({
  toolUseId: id,
  name,
  input,
});

describe("runAgentLoop", () => {
  it("completes when the response has no tool calls, delivering the streamed text", async () => {
    const { deps, events } = makeDeps([{ text: "He works at CodeSignal.", toolUses: [] }]);

    const state = await runAgentLoop(createInitialState("Where does he work?", []), deps, emitInto(events));

    expect(state.status).toBe("complete");
    expect(state.answer).toBe("He works at CodeSignal.");
    expect(state.truncated).toBe(false);
    expect(events.some((event) => event.type === "token")).toBe(true);
  });

  it("marks the answer truncated when max_tokens cuts the final response", async () => {
    const { deps } = makeDeps([
      { text: "A very long answer that got cut o", toolUses: [], stopReason: "max_tokens" },
    ]);

    const state = await runAgentLoop(createInitialState("Long question?", []), deps, () => {});

    expect(state.status).toBe("complete");
    expect(state.truncated).toBe(true);
    expect(state.answer).toBe("A very long answer that got cut o");
    expect(state.steps).toBe(1);
  });

  it("executes tool calls, appends assistant and tool messages, then completes", async () => {
    const { deps, events, calls } = makeDeps([
      { text: "Let me check the project list.", toolUses: [toolCall("t1")] },
      { text: "Done.", toolUses: [] },
    ]);

    const state = await runAgentLoop(createInitialState("TS projects?", []), deps, emitInto(events));

    expect(state.status).toBe("complete");
    expect(state.answer).toBe("Done.");
    expect(state.toolCallsUsed).toBe(1);

    const firstStep = calls[0]!;
    expect(firstStep.messages).toHaveLength(1);
    expect(firstStep.messages[0]).toEqual({ role: "user", content: "TS projects?" });

    const secondStep = calls[1]!;
    expect(secondStep.messages).toHaveLength(3);
    expect(secondStep.messages[1]).toMatchObject({
      role: "assistant",
      content: "Let me check the project list.",
      tool_calls: [{ id: "t1", type: "function", function: { name: "list_projects", arguments: "{}" } }],
    });
    expect(secondStep.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      name: "list_projects",
      content: JSON.stringify({ data: 1 }),
    });

    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "list_projects", status: "started" },
      { type: "tool", name: "list_projects", status: "completed" },
    ]);
  });

  it("records tool failures as tool results without throwing", async () => {
    const { deps, calls } = makeDeps([
      { text: "", toolUses: [toolCall("t1", "broken_tool")] },
      { text: "Answer anyway.", toolUses: [] },
    ]);
    deps.tools = fakeRegistry(async () => ({ ok: false, error: "Unknown tool: broken_tool" }));

    const state = await runAgentLoop(createInitialState("Q?", []), deps, () => {});

    expect(state.status).toBe("complete");
    const secondStep = calls[1]!;
    expect(secondStep.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      name: "broken_tool",
      content: JSON.stringify({ error: "Unknown tool: broken_tool" }),
    });
  });

  it("stops executing tools past the per-request budget and tells the model to finish", async () => {
    const { deps, calls } = makeDeps([
      { text: "", toolUses: [toolCall("t1"), toolCall("t2"), toolCall("t3")] },
      { text: "Answer.", toolUses: [] },
    ]);
    deps.maxToolCalls = 2;

    const state = await runAgentLoop(createInitialState("Q?", []), deps, () => {});

    expect(state.status).toBe("complete");
    expect(state.toolCallsUsed).toBe(2);
    const secondStep = calls[1]!;
    const budgetNote = secondStep.messages.find(
      (message) => message.role === "tool" && message.content.includes("budget"),
    );
    expect(budgetNote).toMatchObject({ tool_call_id: "t3" });
  });

  it("returns max_steps when the model keeps calling tools until the iteration cap", async () => {
    const { deps } = makeDeps(
      [
        { text: "checking", toolUses: [toolCall("t1")] },
        { text: "still checking", toolUses: [toolCall("t2")] },
        { text: "yet again", toolUses: [toolCall("t3")] },
      ],
      { maxIterations: 3 },
    );

    const state = await runAgentLoop(createInitialState("Q?", []), deps, () => {});

    expect(state.status).toBe("max_steps");
    expect(state.steps).toBe(3);
    expect(state.answer).toBe("");
  });

  it("retries an empty response once with a system nudge, then completes", async () => {
    const { deps, calls } = makeDeps([
      { text: "", toolUses: [] },
      { text: "Answer.", toolUses: [] },
    ]);

    const state = await runAgentLoop(createInitialState("Q?", []), deps, () => {});

    expect(state.status).toBe("complete");
    expect(state.answer).toBe("Answer.");
    const secondStep = calls[1]!;
    expect(secondStep.messages).toHaveLength(2);
    expect(secondStep.messages[1]?.role).toBe("system");
    expect(secondStep.messages[1]?.content).toContain("previous response was empty");
  });

  it("fails the turn through max_steps after two empty responses", async () => {
    const { deps } = makeDeps([
      { text: "", toolUses: [] },
      { text: "", toolUses: [] },
    ]);

    const state = await runAgentLoop(createInitialState("Q?", []), deps, () => {});

    expect(state.status).toBe("max_steps");
    expect(state.answer).toBe("");
  });

  it("maps prior conversation into native messages with the user request last", async () => {
    const { deps, calls } = makeDeps([
      { text: "Answer.", toolUses: [] },
    ]);

    await runAgentLoop(
      createInitialState("Follow-up?", [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
      ]),
      deps,
      () => {},
    );

    const firstStep = calls[0]!;
    expect(firstStep.messages).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Follow-up?" },
    ]);
  });

  it("builds multimodal content parts for attachments and inlines text files", async () => {
    const { deps, calls } = makeDeps([{ text: "Answer.", toolUses: [] }]);

    await runAgentLoop(
      createInitialState("What is in these files?", [], [
        { name: "notes.txt", mimeType: "text/plain", data: "aGVsbG8=" },
        { name: "photo.png", mimeType: "image/png", data: "aGVsbG8=" },
        { name: "doc.pdf", mimeType: "application/pdf", data: "aGVsbG8=" },
      ]),
      deps,
      () => {},
    );

    const firstStep = calls[0]!;
    const userMessage = firstStep.messages[0]!;
    expect(userMessage.role).toBe("user");
    const parts = userMessage.content as Array<Record<string, unknown>>;

    expect(parts).toHaveLength(3);
    expect(parts[0]?.type).toBe("text");
    const text = parts[0]?.text as string;
    expect(text).toContain("What is in these files?");
    expect(text).toContain("[Attached file: notes.txt]");
    expect(text).toContain("<attached_file>\nhello\n</attached_file>");
    expect(text).toContain("[Attached image: photo.png]");
    expect(text).toContain("[Attached document: doc.pdf]");
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,aGVsbG8=" },
    });
    expect(parts[2]).toEqual({
      type: "file",
      file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,aGVsbG8=" },
    });
  });
});
