export const agentConfig = {
  maxIterations: process.env.MAX_AGENT_ITERATIONS
    ? Number(process.env.MAX_AGENT_ITERATIONS)
    : 8,
  maxToolCalls: process.env.MAX_TOOL_CALLS
    ? Number(process.env.MAX_TOOL_CALLS)
    : 12,
};
