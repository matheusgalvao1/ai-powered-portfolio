export const modelConfig = {
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  modelId: process.env.OPENROUTER_MODEL_ID ?? "deepseek/deepseek-v4-flash-0731",
  siteUrl: process.env.OPENROUTER_SITE_URL,
  siteName: process.env.OPENROUTER_SITE_NAME ?? "Matheus's Portfolio Assistant",
  maxOutputTokens: process.env.MAX_OUTPUT_TOKENS
    ? Number(process.env.MAX_OUTPUT_TOKENS)
    : 1024,
  temperature: process.env.MODEL_TEMPERATURE
    ? Number(process.env.MODEL_TEMPERATURE)
    : 0.3,
};
