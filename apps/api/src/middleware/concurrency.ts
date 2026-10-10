import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "@portfolio/shared";
import { ChatErrorCode } from "@portfolio/shared";
import { concurrencyConfig } from "@portfolio/config";

// SSE turns are long-lived and each can drive several upstream model calls
// (one per agent iteration), so requests need a concurrency cap on top of the
// rate limit. Counters are released on both "close" (client disconnect) and
// "finish" (normal end) — whichever Node emits, the flag keeps it idempotent.
// In-memory only: same single-process caveat as the rate limiter.
export function createConcurrencyMiddleware({
  maxPerIp = concurrencyConfig.maxPerIp,
  maxGlobal = concurrencyConfig.maxGlobal,
}: { maxPerIp?: number; maxGlobal?: number } = {}) {
  const inFlightPerIp = new Map<string, number>();
  let inFlightGlobal = 0;

  return function concurrencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ip = req.ip ?? "unknown";

    if (inFlightGlobal >= maxGlobal || (inFlightPerIp.get(ip) ?? 0) >= maxPerIp) {
      const body: ApiError = {
        error: {
          code: ChatErrorCode.TOO_MANY_CONCURRENT,
          message:
            "Too many concurrent requests. Please wait for your current response to finish.",
          requestId: randomUUID(),
        },
      };
      res.status(429).json(body);
      return;
    }

    inFlightPerIp.set(ip, (inFlightPerIp.get(ip) ?? 0) + 1);
    inFlightGlobal += 1;

    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      inFlightGlobal -= 1;
      const remaining = (inFlightPerIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) {
        inFlightPerIp.delete(ip);
      } else {
        inFlightPerIp.set(ip, remaining);
      }
    };
    res.on("close", release);
    res.on("finish", release);

    next();
  };
}
