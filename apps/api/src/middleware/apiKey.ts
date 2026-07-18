import type { NextFunction, Request, Response } from "express";
import { apiKeyConfig } from "@portfolio/config";

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // No API_KEY configured means the check is disabled — keeps local dev
  // working with zero extra required config.
  if (!apiKeyConfig.apiKey) {
    next();
    return;
  }

  if (req.header("X-Api-Key") !== apiKeyConfig.apiKey) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  next();
}
