export const modelConfig = {
  modelId: process.env.BEDROCK_MODEL_ID ?? "zai.glm-5",
  region: process.env.BEDROCK_REGION ?? "us-east-1",
  maxOutputTokens: process.env.MAX_OUTPUT_TOKENS
    ? Number(process.env.MAX_OUTPUT_TOKENS)
    : 1024,
  temperature: process.env.MODEL_TEMPERATURE
    ? Number(process.env.MODEL_TEMPERATURE)
    : 0.3,
};
