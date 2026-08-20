import type { z } from "zod";

// Provider-agnostic on purpose: this package knows nothing about the model
// provider.
// The agent loop maps ToolSpec.inputJsonSchema into the provider's tool
// config format.
export type ToolSpec = {
  name: string;
  description: string;
  inputJsonSchema: Record<string, unknown>;
};

export type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (input: unknown) => Promise<unknown> | unknown;
};

// Tool failures are data returned to the model, never exceptions — the loop
// records them as tool results and continues. Messages must stay safe to
// show a model/user (no stack traces).
export type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string };
