import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import {
  createBedrockStep,
  createInitialState,
  runAgentLoop,
  type AgentState,
  type EmitFn,
} from "@portfolio/agent";
import {
  createGetContactInformationTool,
  createListProjectsTool,
  createToolRegistry,
  type PortfolioData,
} from "@portfolio/tools";
import type { ChatSource, ConversationMessage } from "@portfolio/shared";

type PortfolioAgentOptions = {
  systemPrompt: string;
  modelId: string;
  region: string;
  maxOutputTokens?: number;
  temperature?: number;
  maxIterations: number;
  maxToolCalls: number;
  portfolio: PortfolioData;
  validSources: ChatSource[];
  client?: BedrockRuntimeClient;
};

export type PortfolioAgent = {
  run(
    message: string,
    conversation: ConversationMessage[],
    emit: EmitFn,
  ): Promise<AgentState>;
};

export function createPortfolioAgent(options: PortfolioAgentOptions): PortfolioAgent {
  const registry = createToolRegistry([
    createListProjectsTool(options.portfolio),
    createGetContactInformationTool(options.portfolio),
  ]);

  // Credentials resolve automatically from AWS_BEARER_TOKEN_BEDROCK when no
  // explicit credentials are configured — no manual wiring needed.
  const client = options.client ?? new BedrockRuntimeClient({ region: options.region });

  const step = createBedrockStep({
    client,
    modelId: options.modelId,
    systemPrompt: options.systemPrompt,
    toolSpecs: registry.specs(),
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
  });

  return {
    run(message, conversation, emit) {
      return runAgentLoop(
        createInitialState(message, conversation),
        {
          step,
          tools: registry,
          validSources: options.validSources,
          maxIterations: options.maxIterations,
          maxToolCalls: options.maxToolCalls,
        },
        emit,
      );
    },
  };
}
