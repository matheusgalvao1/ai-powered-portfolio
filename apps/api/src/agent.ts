import OpenAI from "openai";
import type { ConversationMessage } from "@portfolio/shared";

type AgentOptions = {
  systemPrompt: string;
  model?: string;
  client?: OpenAI;
};

export class Agent {
  private systemPrompt: string;
  private model: string | undefined;
  private client: OpenAI;

  constructor({ systemPrompt, model, client }: AgentOptions) {
    if (!systemPrompt) {
      throw new Error("Agent requires a systemPrompt");
    }

    this.systemPrompt = systemPrompt;
    this.model = model;
    this.client = client ?? new OpenAI();
  }

  async send(
    message: string,
    { conversation = [] }: { conversation?: ConversationMessage[] } = {},
    onToken: (value: string) => void = () => {},
  ): Promise<{ answer: string; conversation: ConversationMessage[] }> {
    const input =
      conversation.length === 0
        ? message
        : [...conversation, { role: "user" as const, content: message }];

    const stream = this.client.responses.stream({
      model: this.model,
      instructions: this.systemPrompt,
      input,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        onToken(event.delta);
      }
    }

    const response = await stream.finalResponse();
    const answer = response.output_text;
    const userMessage: ConversationMessage = {
      role: "user",
      content: message,
    };

    return {
      answer,
      conversation: [
        ...conversation,
        userMessage,
        { role: "assistant", content: answer },
      ],
    };
  }
}
