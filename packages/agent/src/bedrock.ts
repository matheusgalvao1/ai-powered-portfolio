import {
  ConverseStreamCommand,
  type BedrockRuntimeClient,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import type { ToolSpec } from "@portfolio/tools";
import type { StepFn, ToolUseRequest } from "./types.js";

// The real StepFn: one streaming Bedrock Converse call. Text deltas are
// forwarded as tokens; tool-use input arrives as string chunks per content
// block (verified empirically against zai.glm-5) and is accumulated then
// JSON-parsed at block end. Reasoning deltas only signal thinking
// started/stopped — the reasoning content itself is never forwarded.
export function createBedrockStep(options: {
  client: BedrockRuntimeClient;
  modelId: string;
  systemPrompt: string;
  toolSpecs: ToolSpec[];
  maxOutputTokens?: number | undefined;
  temperature?: number | undefined;
}): StepFn {
  const tools: Tool[] = options.toolSpecs.map((spec) => ({
    toolSpec: {
      name: spec.name,
      description: spec.description,
      inputSchema: { json: spec.inputJsonSchema as DocumentType },
    },
  }));

  return async ({ prompt, onToken, onThinking }) => {
    const response = await options.client.send(
      new ConverseStreamCommand({
        modelId: options.modelId,
        system: [{ text: options.systemPrompt }],
        messages: [{ role: "user", content: [{ text: prompt }] }],
        toolConfig: { tools, toolChoice: { auto: {} } },
        inferenceConfig: {
          maxTokens: options.maxOutputTokens,
          temperature: options.temperature,
        },
      }),
    );

    let text = "";
    let stopReason: string | undefined;
    let thinking = false;
    const pendingToolUses = new Map<number, { toolUseId: string; name: string; inputJson: string }>();

    for await (const event of response.stream ?? []) {
      const startToolUse = event.contentBlockStart?.start?.toolUse;
      if (startToolUse) {
        pendingToolUses.set(event.contentBlockStart?.contentBlockIndex ?? -1, {
          toolUseId: startToolUse.toolUseId ?? "",
          name: startToolUse.name ?? "",
          inputJson: "",
        });
      }

      const delta = event.contentBlockDelta?.delta;
      if (delta?.reasoningContent) {
        if (!thinking) {
          thinking = true;
          onThinking("started");
        }
        continue;
      }
      if (thinking && (delta?.text !== undefined || delta?.toolUse !== undefined)) {
        thinking = false;
        onThinking("stopped");
      }
      if (delta?.text) {
        text += delta.text;
        onToken(delta.text);
      }
      if (delta?.toolUse?.input !== undefined) {
        const pending = pendingToolUses.get(event.contentBlockDelta?.contentBlockIndex ?? -1);
        if (pending) {
          pending.inputJson += delta.toolUse.input;
        }
      }

      if (event.messageStop) {
        stopReason = event.messageStop.stopReason;
      }
    }

    if (thinking) {
      onThinking("stopped");
    }

    const toolUses: ToolUseRequest[] = [];
    for (const pending of pendingToolUses.values()) {
      let input: unknown = {};
      if (pending.inputJson.trim().length > 0) {
        try {
          input = JSON.parse(pending.inputJson);
        } catch {
          // Malformed tool input becomes an empty object; the registry's
          // schema validation turns that into a safe error tool result.
        }
      }
      toolUses.push({ toolUseId: pending.toolUseId, name: pending.name, input });
    }

    return { text, toolUses, stopReason };
  };
}
