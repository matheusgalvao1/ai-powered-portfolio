export const rateLimitConfig = {
  windowSeconds: process.env.RATE_LIMIT_WINDOW_SECONDS
    ? Number(process.env.RATE_LIMIT_WINDOW_SECONDS)
    : 60,
  maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS
    ? Number(process.env.RATE_LIMIT_MAX_REQUESTS)
    : 20,
};
