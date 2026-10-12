import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { createCorsMiddleware } from "./cors.js";

function runCors(origin: string | undefined, method = "GET") {
  const headers = new Map<string, string>();
  const res = {
    vary: vi.fn(),
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    sendStatus: vi.fn(),
  } as unknown as Response;
  const req = {
    header: (name: string) => (name === "Origin" ? origin : undefined),
    method,
  } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;

  createCorsMiddleware([
    "https://matheusgalvao.com",
    "https://www.matheusgalvao.com",
  ])(req, res, next);

  return { headers, res, next };
}

describe("createCorsMiddleware", () => {
  it.each(["https://matheusgalvao.com", "https://www.matheusgalvao.com"])(
    "allows the configured origin %s",
    (origin) => {
      const { headers } = runCors(origin);
      expect(headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    },
  );

  it("does not grant access to an unconfigured origin", () => {
    const { headers } = runCors("https://malicious.example");
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });

  it("ends preflight requests with 204", () => {
    const { res, next } = runCors("https://www.matheusgalvao.com", "OPTIONS");
    expect(res.sendStatus).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });
});
