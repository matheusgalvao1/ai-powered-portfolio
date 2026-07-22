import { z } from "zod";
import type { ToolSpec } from "./types.js";

// Termination semaphore, not a data tool: a response is final if and only
// if it calls this. It carries no answer content — the answer is the plain
// assistant text — only source citations, which are validated leniently and
// degrade to "no sources" rather than failing the turn.
export const FINAL_ANSWER_TOOL_NAME = "final_answer";

export const FinalAnswerInputSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string(),
        section: z.string().optional(),
      }),
    )
    .default([]),
});

export type FinalAnswerInput = z.infer<typeof FinalAnswerInputSchema>;

export const finalAnswerSpec: ToolSpec = {
  name: FINAL_ANSWER_TOOL_NAME,
  description:
    "Call this in the same response as your final answer text to signal the answer is complete. " +
    "Pass the knowledge-base section titles that support your answer as sources (empty array if none apply).",
  inputJsonSchema: z.toJSONSchema(FinalAnswerInputSchema),
};
