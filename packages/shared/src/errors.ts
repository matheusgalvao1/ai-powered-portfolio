export const ChatErrorCode = {
  MODEL_ERROR: "MODEL_ERROR",
} as const;

export type ChatErrorCode = (typeof ChatErrorCode)[keyof typeof ChatErrorCode];
