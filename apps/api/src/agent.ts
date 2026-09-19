import {
  createOpenRouterStep,
  createInitialState,
  runAgentLoop,
  type AgentState,
  type EmitFn,
  type UserAttachment,
} from "@portfolio/agent";
import {
  createGetContactInformationTool,
  createListProjectsTool,
  createToolRegistry,
  type PortfolioData,
} from "@portfolio/tools";
import type { ConversationMessage } from "@portfolio/shared";

type PortfolioAgentOptions = {
  systemPrompt: string;
  apiKey: string;
  modelId: string;
  siteUrl?: string;
  siteName?: string;
  maxOutputTokens?: number;
  temperature?: number;
  maxIterations: number;
  maxToolCalls: number;
  portfolio: PortfolioData;
};

export type PortfolioAgent = {
  run(
    message: string,
    conversation: ConversationMessage[],
    attachments: UserAttachment[],
    emit: EmitFn,
  ): Promise<AgentState>;
};

export function createPortfolioAgent(options: PortfolioAgentOptions): PortfolioAgent {
  const registry = createToolRegistry([
    createListProjectsTool(options.portfolio),
    createGetContactInformationTool(options.portfolio),
  ]);

  const step = createOpenRouterStep({
    apiKey: options.apiKey,
    modelId: options.modelId,
    systemPrompt: options.systemPrompt,
    toolSpecs: registry.specs(),
    siteUrl: options.siteUrl,
    siteName: options.siteName,
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
  });

  return {
    run(message, conversation, attachments, emit) {
      return runAgentLoop(
        createInitialState(message, conversation, attachments),
        {
          step,
          tools: registry,
          maxIterations: options.maxIterations,
          maxToolCalls: options.maxToolCalls,
        },
        emit,
      );
    },
  };
}
