import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createCloudflareAccessMiddleware } from "./cloudflareAccess.js";

const TEAM_DOMAIN = "https://portfolio.cloudflareaccess.com";
const AUDIENCE = "admin-api-audience";
const ALLOWED_EMAIL = "matheus@example.com";
const KEY_ID = "access-test-key";

async function withProtectedRoute<T>(
  token: string | undefined,
  middleware: express.RequestHandler,
  run: (response: Response) => Promise<T>,
): Promise<T> {
  const app = express();
  app.get("/admin", middleware, (_req, res) => res.send("authorized"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/admin`, {
      headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
    });
    return await run(response);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function makeAccessFixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwkSet = {
    keys: [{ ...publicJwk, kid: KEY_ID, alg: "RS256", use: "sig" }],
  };
  const fetcher: typeof fetch = vi.fn(async () =>
    new Response(JSON.stringify(jwkSet), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  const middleware = (allowedEmail = ALLOWED_EMAIL) =>
    createCloudflareAccessMiddleware(
      {
        teamDomain: TEAM_DOMAIN.replace("https://", ""),
        audience: AUDIENCE,
        allowedEmail,
      },
      fetcher,
    );
  const token = (email: string, audience = AUDIENCE) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  return { fetcher, middleware, token };
}

describe("Cloudflare Access middleware", () => {
  it("verifies the Access signature, issuer, audience, and allowed email", async () => {
    const fixture = await makeAccessFixture();
    const response = await withProtectedRoute(
      await fixture.token(ALLOWED_EMAIL),
      fixture.middleware(),
      async (result) => result,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("authorized");
    expect(fixture.fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a valid Access token for a different email", async () => {
    const fixture = await makeAccessFixture();
    const response = await withProtectedRoute(
      await fixture.token("someone-else@example.com"),
      fixture.middleware(),
      async (result) => result,
    );

    expect(response.status).toBe(403);
  });

  it("rejects missing tokens, wrong audiences, and missing configuration", async () => {
    const fixture = await makeAccessFixture();
    const missingTokenResponse = await withProtectedRoute(
      undefined,
      fixture.middleware(),
      async (result) => result,
    );
    const wrongAudienceResponse = await withProtectedRoute(
      await fixture.token(ALLOWED_EMAIL, "other-audience"),
      fixture.middleware(),
      async (result) => result,
    );
    const unconfiguredResponse = await withProtectedRoute(
      "forged-token",
      createCloudflareAccessMiddleware({}),
      async (result) => result,
    );

    expect(missingTokenResponse.status).toBe(401);
    expect(wrongAudienceResponse.status).toBe(401);
    expect(unconfiguredResponse.status).toBe(404);
  });
});
