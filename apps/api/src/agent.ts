import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import type { ConversationMessage } from "@portfolio/shared";

type AgentOptions = {
  systemPrompt: string;
  modelId: string;
  region: string;
  maxOutputTokens?: number;
  temperature?: number;
  client?: BedrockRuntimeClient;
};

function toBedrockMessage(message: ConversationMessage): Message {
  return {
    role: message.role,
    content: [{ text: message.content }],
  };
}

export class Agent {
  private systemPrompt: string;
  private modelId: string;
  private maxOutputTokens: number | undefined;
  private temperature: number | undefined;
  private client: BedrockRuntimeClient;

  constructor({
    systemPrompt,
    modelId,
    region,
    maxOutputTokens,
    temperature,
    client,
  }: AgentOptions) {
    if (!systemPrompt) {
      throw new Error("Agent requires a systemPrompt");
    }

    this.systemPrompt = systemPrompt;
    this.modelId = modelId;
    this.maxOutputTokens = maxOutputTokens;
    this.temperature = temperature;
    // Credentials are resolved automatically from AWS_BEARER_TOKEN_BEDROCK
    // (Bedrock API key auth) when no explicit credentials are configured —
    // no manual wiring needed.
    this.client = client ?? new BedrockRuntimeClient({ region });
  }

  async send(
    message: string,
    { conversation = [] }: { conversation?: ConversationMessage[] } = {},
    onToken: (value: string) => void = () => {},
  ): Promise<{ answer: string; conversation: ConversationMessage[] }> {
    const userMessage: ConversationMessage = { role: "user", content: message };
    const messages: Message[] = [...conversation, userMessage].map(toBedrockMessage);

    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: this.systemPrompt }],
      messages,
      inferenceConfig: {
        maxTokens: this.maxOutputTokens,
        temperature: this.temperature,
      },
    });

    const response = await this.client.send(command);

    let answer = "";
    for await (const event of response.stream ?? []) {
      const text = event.contentBlockDelta?.delta?.text;
      if (text) {
        answer += text;
        onToken(text);
      }
    }

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
