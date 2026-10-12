import type { RequestHandler } from "express";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export type CloudflareAccessConfig = {
  teamDomain?: string;
  audience?: string;
  allowedEmail?: string;
};

export function createCloudflareAccessMiddleware(
  config: CloudflareAccessConfig,
  fetcher: typeof fetch = fetch,
): RequestHandler {
  let issuer: string | null = null;
  try {
    const domain = config.teamDomain?.trim() ?? "";
    const teamUrl = new URL(
      domain.startsWith("https://") ? domain : `https://${domain}`,
    );
    if (
      teamUrl.protocol === "https:" &&
      teamUrl.pathname === "/" &&
      !teamUrl.search &&
      !teamUrl.hash
    ) {
      issuer = teamUrl.origin;
    }
  } catch {
    issuer = null;
  }

  const audience = config.audience?.trim();
  const allowedEmail = config.allowedEmail?.trim().toLowerCase();
  if (!issuer || !audience || !allowedEmail) {
    return (_req, res) => {
      res.sendStatus(404);
    };
  }

  const jwks = createRemoteJWKSet(
    new URL("/cdn-cgi/access/certs", issuer),
    { [customFetch]: fetcher },
  );

  return async (req, res, next) => {
    const token = req.header("Cf-Access-Jwt-Assertion");
    if (!token) {
      res.sendStatus(401);
      return;
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: ["RS256"],
      });
      if (
        typeof payload.email !== "string" ||
        payload.email.trim().toLowerCase() !== allowedEmail
      ) {
        res.sendStatus(403);
        return;
      }
      next();
    } catch {
      res.sendStatus(401);
    }
  };
}
