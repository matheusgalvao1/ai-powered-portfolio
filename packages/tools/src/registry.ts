import { z } from "zod";
import { finalAnswerSpec, FINAL_ANSWER_TOOL_NAME } from "./finalAnswer.js";
import type { RegisteredTool, ToolOutcome, ToolSpec } from "./types.js";

export type ToolRegistry = {
  specs(): ToolSpec[];
  execute(name: string, rawInput: unknown): Promise<ToolOutcome>;
};

// The registry always includes final_answer in its specs (the model must be
// able to call it), but never executes it — the agent loop intercepts it as
// the termination signal before execution is ever attempted.
export function createToolRegistry(tools: RegisteredTool[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    specs() {
      return [
        ...tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputJsonSchema: z.toJSONSchema(tool.inputSchema),
        })),
        finalAnswerSpec,
      ];
    },

    async execute(name, rawInput) {
      if (name === FINAL_ANSWER_TOOL_NAME) {
        return { ok: false, error: "final_answer is a control signal, not an executable tool." };
      }

      const tool = byName.get(name);
      if (!tool) {
        return { ok: false, error: `Unknown tool: ${name}` };
      }

      const parsed = tool.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: `Invalid input for ${name}: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ")}`,
        };
      }

      try {
        const result = await tool.execute(parsed.data);
        return { ok: true, result };
      } catch (error) {
        // Full error stays server-side; the model only ever sees a safe
        // summary (PRD 9.10: tool errors must not expose stack traces).
        console.error(`Tool ${name} failed:`, error);
        return { ok: false, error: `The ${name} tool failed to execute. Answer without it if possible.` };
      }
    },
  };
}
