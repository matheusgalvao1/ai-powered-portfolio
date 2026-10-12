import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../sessionStore.js";
import { createAdminRouter } from "./admin.js";

const SESSION_ID = "7c9e6679-742f-40de-944b-e07fc1f90ae7";

async function withAdminApi<T>(
  enabled: boolean,
  run: (baseUrl: string, store: ReturnType<typeof createSessionStore>) => Promise<T>,
): Promise<T> {
  const store = createSessionStore({ dbPath: ":memory:" });
  const app = express();
  app.use("/admin", createAdminRouter({ store, enabled }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${address.port}`, store);
  } finally {
    store.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("admin router", () => {
  it("returns no admin data when the local-only route is disabled", async () => {
    await withAdminApi(false, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/overview`);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("serves the overview and transcript when enabled", async () => {
    await withAdminApi(true, async (baseUrl, store) => {
      store.appendMessage(SESSION_ID, "user", "A recruiter question");
      store.appendMessage(SESSION_ID, "assistant", "A portfolio answer");

      const overviewResponse = await fetch(`${baseUrl}/admin/overview?range=all`);
      expect(overviewResponse.status).toBe(200);
      expect(overviewResponse.headers.get("cache-control")).toBe("no-store");
      expect(await overviewResponse.json()).toMatchObject({
        totalConversations: 1,
        activeConversations: 1,
        messagesInRange: 2,
      });

      const transcriptResponse = await fetch(
        `${baseUrl}/admin/conversations/${SESSION_ID}`,
      );
      expect(transcriptResponse.status).toBe(200);
      expect(await transcriptResponse.json()).toMatchObject({
        sessionId: SESSION_ID,
        messages: [
          { role: "user", content: "A recruiter question" },
          { role: "assistant", content: "A portfolio answer" },
        ],
      });
    });
  });

  it("rejects unsupported ranges and invalid session IDs", async () => {
    await withAdminApi(true, async (baseUrl) => {
      const invalidRange = await fetch(`${baseUrl}/admin/overview?range=90d`);
      const invalidSession = await fetch(`${baseUrl}/admin/conversations/not-a-uuid`);
      expect(invalidRange.status).toBe(400);
      expect(invalidSession.status).toBe(400);
    });
  });
});
