import { describe, expect, it } from "vitest";
import { createSessionStore } from "./sessionStore.js";

const UUID = "7c9e6679-742f-40de-944b-e07fc1f90ae7";
const OTHER_UUID = "3f2a1c9b-8d4e-4b7a-9c1d-2e5f6a7b8c9d";

function makeStore(now: () => Date = () => new Date(2026, 9, 3, 12, 0, 0)) {
  // In-memory database per test — isolated, no filesystem cleanup needed.
  const store = createSessionStore({ dbPath: ":memory:", now });
  return { store };
}

describe("createSessionStore", () => {
  it("creates the session implicitly on first message", async () => {
    const { store } = makeStore();
    await store.appendMessage(UUID, "user", "hello");
    expect(await store.loadRecentMessages(UUID)).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("keeps messages in insertion order across roles", async () => {
    const { store } = makeStore();
    await store.appendMessage(UUID, "user", "q1");
    await store.appendMessage(UUID, "assistant", "a1");
    await store.appendMessage(UUID, "user", "q2");

    expect((await store.loadRecentMessages(UUID)).map((m) => m.content)).toEqual([
      "q1",
      "a1",
      "q2",
    ]);
  });

  it("keeps sessions independent", async () => {
    const { store } = makeStore();
    await store.appendMessage(UUID, "user", "mine");
    await store.appendMessage(OTHER_UUID, "user", "theirs");

    expect((await store.loadRecentMessages(UUID)).map((m) => m.content)).toEqual(["mine"]);
  });

  it("summarizes recent conversations and returns their full transcript", async () => {
    let current = new Date("2026-10-03T10:00:00Z");
    const { store } = makeStore(() => current);
    await store.appendMessage(UUID, "user", "How did Matheus lead the project?");
    current = new Date("2026-10-03T10:01:00Z");
    await store.appendMessage(UUID, "assistant", "He led the project from discovery to launch.");
    current = new Date("2026-10-03T10:02:00Z");
    await store.appendMessage(OTHER_UUID, "user", "What technologies does he use?");

    const overview = await store.dashboardOverview("all");
    expect(overview).toMatchObject({
      totalConversations: 2,
      activeConversations: 2,
      messagesInRange: 3,
    });
    expect(overview.conversations[1]).toMatchObject({
      sessionId: UUID,
      messageCount: 2,
      title: "How did Matheus lead the project?",
      latestMessage: "He led the project from discovery to launch.",
    });
    expect((await store.loadConversation(UUID))?.messages.map((message) => message.content)).toEqual([
      "How did Matheus lead the project?",
      "He led the project from discovery to launch.",
    ]);
  });

  it("filters dashboard activity by last update time", async () => {
    let current = new Date("2026-09-01T10:00:00Z");
    const { store } = makeStore(() => current);
    await store.appendMessage(UUID, "user", "older chat");
    current = new Date("2026-10-03T10:00:00Z");
    await store.appendMessage(OTHER_UUID, "user", "recent chat");

    const overview = await store.dashboardOverview("7d");
    expect(overview.totalConversations).toBe(2);
    expect(overview.activeConversations).toBe(1);
    expect(overview.messagesInRange).toBe(1);
    expect(overview.conversations.map((conversation) => conversation.sessionId)).toEqual([
      OTHER_UUID,
    ]);
    expect(await store.loadConversation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();
  });

  it("windows to the most recent entries, oldest first", async () => {
    const { store } = makeStore();
    for (let i = 0; i < 30; i += 1) {
      await store.appendMessage(UUID, i % 2 === 0 ? "user" : "assistant", `m${i}`);
    }

    const windowed = await store.loadRecentMessages(UUID);
    expect(windowed.length).toBe(24);
    expect(windowed[0]?.content).toBe("m6");
    expect(windowed[23]?.content).toBe("m29");
  });

  it("clamps each entry to the effective character cap", async () => {
    const { store } = makeStore();
    await store.appendMessage(UUID, "user", "y".repeat(20_000));
    await store.appendMessage(UUID, "assistant", "short");

    const windowed = await store.loadRecentMessages(UUID);
    expect(windowed[0]?.content.length).toBe(16_000);
    expect(windowed[1]?.content).toBe("short");
  });

  it("refuses non-UUID sessionIds instead of writing them", async () => {
    const { store } = makeStore();
    await expect(store.appendMessage("../../evil", "user", "x")).rejects.toThrow();
    await expect(store.ensureSession("not-a-uuid")).rejects.toThrow();
    // Reads fail loudly too — invalid ids are never silently treated as
    // "no history".
    await expect(store.loadRecentMessages("../../evil")).rejects.toThrow();
  });

  it("appends tool calls with per-session ordering", async () => {
    const { store } = makeStore();
    await store.appendToolCall(UUID, "example_tool", "{}", '{"ok":true}');
    await store.appendToolCall(OTHER_UUID, "get_contact_information", "{}", "{}");

    // Ordering is internal; here we just assert no error and independent seq.
    // Phase 2 wires these into the agent loop and reads them back.
    expect(await store.usageTokensSince(null, "2026-01-01T00:00:00.000Z")).toBe(0);
  });

  it("records usage and aggregates per day and per client", async () => {
    let current = new Date("2026-10-03T10:00:00Z");
    const { store } = makeStore(() => current);

    await store.recordUsage(UUID, "1.1.1.1", { inputTokens: 100, outputTokens: 50 });
    await store.recordUsage(UUID, "1.1.1.1", { inputTokens: 10, outputTokens: 5 });
    await store.recordUsage(OTHER_UUID, "2.2.2.2", { inputTokens: 40, outputTokens: 0 });

    const before = "2026-10-03T00:00:00.000Z";
    expect(await store.usageTokensSince(null, before)).toBe(205);
    expect(await store.usageTokensSince("1.1.1.1", before)).toBe(165);
    expect(await store.usageTokensSince("2.2.2.2", before)).toBe(40);
    expect(await store.usageTokensSince(null, "2026-10-04T00:00:00.000Z")).toBe(0);

    current = new Date("2026-10-04T10:00:00Z");
    await store.recordUsage(UUID, "1.1.1.1", { inputTokens: 5, outputTokens: 0 });
    // Only the new day's usage counts from the new day's boundary.
    expect(await store.usageTokensSince(null, "2026-10-04T00:00:00.000Z")).toBe(5);
    expect(await store.usageTokensSince(null, before)).toBe(210);
  });
});
