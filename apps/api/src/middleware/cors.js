import { corsConfig } from "../config/index.js";

export function corsMiddleware(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", corsConfig.allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}
