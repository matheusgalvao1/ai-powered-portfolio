import type { NextFunction, Request, Response } from "express";
import { rateLimitConfig } from "@portfolio/config";

type Bucket = {
  count: number;
  windowStart: number;
};

// Fixed-window counter, not sliding-window/token-bucket — simpler, and
// correct enough at this project's scale. In-memory only: fine for a single
// Express process, but won't survive a restart or scale past one instance.
// Swap for a DynamoDB-backed counter (see PRD 6.4) once real traffic and
// infra exist.
export function createRateLimitMiddleware({
  windowSeconds = rateLimitConfig.windowSeconds,
  maxRequests = rateLimitConfig.maxRequests,
}: { windowSeconds?: number; maxRequests?: number } = {}) {
  const buckets = new Map<string, Bucket>();
  const windowMs = windowSeconds * 1000;

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) {
        buckets.delete(key);
      }
    }
  }, windowMs);
  sweep.unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    if (bucket.count >= maxRequests) {
      res.status(429).json({ error: "Too many requests. Please try again shortly." });
      return;
    }

    bucket.count += 1;
    next();
  };
}
