import type { ToolSpec } from "@portfolio/tools";
import type { StepFn, ToolUseRequest } from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

type OpenRouterOptions = {
  apiKey: string;
  modelId: string;
  systemPrompt: string;
  toolSpecs: ToolSpec[];
  maxOutputTokens?: number | undefined;
  temperature?: number | undefined;
  siteUrl?: string | undefined;
  siteName?: string | undefined;
  baseUrl?: string | undefined;
};

type OpenRouterToolCallDelta = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenRouterChunk = {
  error?: {
    message?: string;
  };
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_details?: unknown;
      tool_calls?: OpenRouterToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
};

type PendingToolUse = {
  toolUseId: string;
  name: string;
  inputJson: string;
};

function parseChunk(payload: string): OpenRouterChunk | null {
  try {
    const value: unknown = JSON.parse(payload);
    return value && typeof value === "object" ? (value as OpenRouterChunk) : null;
  } catch {
    return null;
  }
}

function normalizeStopReason(reason: string): string {
  return reason === "length" ? "max_tokens" : reason;
}

function hasReasoning(delta: NonNullable<OpenRouterChunk["choices"]>[number]["delta"]): boolean {
  return (
    (typeof delta?.reasoning === "string" && delta.reasoning.length > 0) ||
    (Array.isArray(delta?.reasoning_details) && delta.reasoning_details.length > 0)
  );
}

function parseToolInput(inputJson: string): unknown {
  if (inputJson.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(inputJson);
  } catch {
    // The loop turns malformed input into a safe tool validation error.
    return {};
  }
}

// The real StepFn: one streaming OpenRouter Chat Completions call. OpenRouter
// normalizes tool calls across providers, so this adapter keeps the rest of the
// agent loop independent from provider-specific message formats.
export function createOpenRouterStep(options: OpenRouterOptions): StepFn {
  if (!options.apiKey.trim()) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  const tools = options.toolSpecs.map((spec) => ({
    type: "function" as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.inputJsonSchema,
    },
  }));
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const endpoint = `${baseUrl}/chat/completions`;

  return async ({ prompt, onToken, onThinking }) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    };

    if (options.siteUrl) {
      headers["HTTP-Referer"] = options.siteUrl;
    }
    if (options.siteName) {
      headers["X-OpenRouter-Title"] = options.siteName;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.modelId,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: prompt },
        ],
        tools,
        tool_choice: "auto",
        stream: true,
        max_tokens: options.maxOutputTokens,
        temperature: options.temperature,
      }),
    });

    if (!response.ok) {
      let message = `OpenRouter request failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        if (body.error?.message) {
          message = body.error.message;
        }
      } catch {
        // Keep the status-based error when the response is not JSON.
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("OpenRouter returned an empty response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const pendingToolUses = new Map<number, PendingToolUse>();
    let buffer = "";
    let text = "";
    let stopReason: string | undefined;
    let thinking = false;
    let streamDone = false;

    const processLine = (rawLine: string): boolean => {
      const line = rawLine.trim();
      if (!line || line.startsWith(":") || !line.startsWith("data:")) {
        return false;
      }

      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") {
        return true;
      }

      const chunk = parseChunk(payload);
      if (!chunk) {
        return false;
      }
      if (chunk.error?.message) {
        throw new Error(chunk.error.message);
      }

      const choice = chunk.choices?.[0];
      if (!choice) {
        return false;
      }

      if (choice.finish_reason) {
        stopReason = normalizeStopReason(choice.finish_reason);
      }

      const delta = choice.delta;
      if (!delta) {
        return false;
      }

      const toolCallDeltas = delta.tool_calls ?? [];
      const reasoning = hasReasoning(delta);
      if (reasoning && !thinking) {
        thinking = true;
        onThinking("started");
      }

      const hasContentDelta = typeof delta.content === "string";
      if (thinking && (hasContentDelta || toolCallDeltas.length > 0)) {
        thinking = false;
        onThinking("stopped");
      }

      if (delta.content) {
        text += delta.content;
        onToken(delta.content);
      }

      for (const toolCall of toolCallDeltas) {
        const index = toolCall.index ?? pendingToolUses.size;
        const pending = pendingToolUses.get(index) ?? {
          toolUseId: toolCall.id ?? `call_${index}`,
          name: "",
          inputJson: "",
        };

        if (toolCall.id) {
          pending.toolUseId = toolCall.id;
        }
        if (toolCall.function?.name) {
          pending.name = toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          pending.inputJson += toolCall.function.arguments;
        }
        pendingToolUses.set(index, pending);
      }

      return false;
    };

    while (!streamDone) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (processLine(line)) {
          streamDone = true;
          break;
        }
      }
    }

    buffer += decoder.decode();
    if (!streamDone && buffer.trim().length > 0) {
      processLine(buffer);
    }

    if (thinking) {
      onThinking("stopped");
    }

    const toolUses: ToolUseRequest[] = [...pendingToolUses.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, pending]) => ({
        toolUseId: pending.toolUseId,
        name: pending.name,
        input: parseToolInput(pending.inputJson),
      }));

    return { text, toolUses, stopReason };
  };
}
