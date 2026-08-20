import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolSpec } from "@portfolio/tools";
import { createOpenRouterStep } from "./openrouter.js";

const TOOL_SPEC: ToolSpec = {
  name: "list_projects",
  description: "List portfolio projects.",
  inputJsonSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

function responseFor(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function chunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOpenRouterStep", () => {
  it("streams text and reasoning events while ignoring SSE comments", async () => {
    const fetchMock = vi.fn(async () =>
      responseFor(
        ": OPENROUTER PROCESSING\n\n" +
          chunk({ choices: [{ delta: { reasoning: "plan" } }] }) +
          chunk({ choices: [{ delta: { content: "Answer" } }] }) +
          chunk({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
          "data: [DONE]\n\n",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens: string[] = [];
    const thinking: string[] = [];
    const step = createOpenRouterStep({
      apiKey: "test-key",
      modelId: "z-ai/glm-5",
      systemPrompt: "Be helpful.",
      toolSpecs: [],
    });

    const result = await step({
      prompt: "Question",
      onToken: (value) => tokens.push(value),
      onThinking: (status) => thinking.push(status),
    });

    expect(result).toMatchObject({ text: "Answer", stopReason: "stop", toolUses: [] });
    expect(tokens).toEqual(["Answer"]);
    expect(thinking).toEqual(["started", "stopped"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("assembles streamed tool-call arguments", async () => {
    const fetchMock = vi.fn(async () =>
      responseFor(
        chunk({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "list_projects", arguments: "{\"limit\":" },
                  },
                ],
              },
            },
          ],
        }) +
          chunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: "5}" } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }) +
          "data: [DONE]\n\n",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const step = createOpenRouterStep({
      apiKey: "test-key",
      modelId: "z-ai/glm-5",
      systemPrompt: "Be helpful.",
      toolSpecs: [TOOL_SPEC],
    });

    const result = await step({
      prompt: "List projects",
      onToken: () => {},
      onThinking: () => {},
    });

    expect(result.stopReason).toBe("tool_calls");
    expect(result.toolUses).toEqual([
      {
        toolUseId: "call_1",
        name: "list_projects",
        input: { limit: 5 },
      },
    ]);
  });
});
