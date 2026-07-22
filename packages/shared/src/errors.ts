// Full taxonomy per PRD 15.2. RETRIEVAL_ERROR is defined for contract
// completeness but nothing emits it yet (no retrieval layer exists).
export const ChatErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  MODEL_ERROR: "MODEL_ERROR",
  RETRIEVAL_ERROR: "RETRIEVAL_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ChatErrorCode = (typeof ChatErrorCode)[keyof typeof ChatErrorCode];

// Envelope for non-streaming HTTP error responses (PRD 15.2).
export type ApiError = {
  error: {
    code: ChatErrorCode;
    message: string;
    requestId: string;
  };
};
