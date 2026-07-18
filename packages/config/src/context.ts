export const contextConfig = {
  maxContextTokens: process.env.MAX_CONTEXT_TOKENS
    ? Number(process.env.MAX_CONTEXT_TOKENS)
    : 50_000,
};
