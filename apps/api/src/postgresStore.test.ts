import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresSessionStore } from "./postgresStore.js";
import { migratePostgres } from "./postgresMigrations.js";
import { Client } from "pg";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SESSION_ID = "7c9e6679-742f-40de-944b-e07fc1f90ae7";
const OTHER_SESSION_ID = "3f2a1c9b-8d4e-4b7a-9c1d-2e5f6a7b8c9d";

describe.skipIf(!DATABASE_URL)("Postgres SessionStore integration", () => {
  beforeAll(async () => {
    await migratePostgres(DATABASE_URL!);
  }, 30_000);

  beforeEach(async () => {
    const client = new Client({
      connectionString: DATABASE_URL,
      ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(DATABASE_URL!).hostname)
        ? false
        : { rejectUnauthorized: true },
    });
    await client.connect();
    await client.query("TRUNCATE usage, tool_calls, messages, sessions RESTART IDENTITY CASCADE");
    await client.end();
  }, 30_000);

  it("persists ordered conversation history and dashboard summaries", async () => {
    const store = createPostgresSessionStore({ connectionString: DATABASE_URL! });
    try {
      await store.appendMessage(SESSION_ID, "user", "What did you build?");
      await store.appendMessage(SESSION_ID, "assistant", "An AI-powered portfolio.");
      await store.appendMessage(OTHER_SESSION_ID, "user", "Second visitor");

      expect(await store.loadRecentMessages(SESSION_ID)).toEqual([
        { role: "user", content: "What did you build?" },
        { role: "assistant", content: "An AI-powered portfolio." },
      ]);
      expect(await store.dashboardOverview("all")).toMatchObject({
        totalConversations: 2,
        activeConversations: 2,
        messagesInRange: 3,
      });
      expect(await store.loadConversation(SESSION_ID)).toMatchObject({
        sessionId: SESSION_ID,
        messages: [{ content: "What did you build?" }, { content: "An AI-powered portfolio." }],
      });
    } finally {
      await store.close();
    }
  }, 30_000);

  it("allocates ordered per-session sequence values for concurrent appends", async () => {
    const store = createPostgresSessionStore({ connectionString: DATABASE_URL! });
    try {
      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          store.appendMessage(SESSION_ID, "user", `message-${index}`),
        ),
      );
      const conversation = await store.loadConversation(SESSION_ID);
      expect(conversation?.messages).toHaveLength(30);
      expect(conversation?.messages.map((message) => message.seq)).toEqual(
        Array.from({ length: 30 }, (_, index) => index + 1),
      );
    } finally {
      await store.close();
    }
  }, 30_000);

  it("aggregates recorded token usage globally and per client", async () => {
    const store = createPostgresSessionStore({ connectionString: DATABASE_URL! });
    try {
      await store.recordUsage(SESSION_ID, "192.0.2.1", { inputTokens: 100, outputTokens: 25 });
      await store.recordUsage(OTHER_SESSION_ID, "192.0.2.2", { inputTokens: 50, outputTokens: 5 });
      const since = new Date(Date.now() - 60_000).toISOString();
      expect(await store.usageTokensSince(null, since)).toBe(180);
      expect(await store.usageTokensSince("192.0.2.1", since)).toBe(125);
    } finally {
      await store.close();
    }
  });
});
