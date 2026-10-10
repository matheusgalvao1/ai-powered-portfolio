// Full taxonomy per PRD 15.2. RETRIEVAL_ERROR is defined for contract
// completeness but nothing emits it yet (no retrieval layer exists). The
// MESSAGE_TOO_LONG / HISTORY_TOO_LARGE / TOO_MANY_CONCURRENT / BUDGET_EXHAUSTED
// codes exist for abuse-proofing (see docs/abuse-proofing-plan.md).
export const ChatErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG",
  HISTORY_TOO_LARGE: "HISTORY_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  TOO_MANY_CONCURRENT: "TOO_MANY_CONCURRENT",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
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
