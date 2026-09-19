import { z } from "zod";
import type { RegisteredTool, ToolOutcome, ToolSpec } from "./types.js";

export type ToolRegistry = {
  specs(): ToolSpec[];
  execute(name: string, rawInput: unknown): Promise<ToolOutcome>;
};

export function createToolRegistry(tools: RegisteredTool[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    specs() {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputJsonSchema: z.toJSONSchema(tool.inputSchema),
      }));
    },

    async execute(name, rawInput) {
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
