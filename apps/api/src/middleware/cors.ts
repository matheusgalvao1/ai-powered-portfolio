import type { Request, Response, NextFunction } from "express";
import { corsConfig } from "@portfolio/config";

export function createCorsMiddleware(allowedOrigins = corsConfig.allowedOrigins) {
  return function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const origin = req.header("Origin");

    res.vary("Origin");
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  };
}

export const corsMiddleware = createCorsMiddleware();
