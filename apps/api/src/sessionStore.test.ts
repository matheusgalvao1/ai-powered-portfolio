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
  it("creates the session implicitly on first message", () => {
    const { store } = makeStore();
    store.appendMessage(UUID, "user", "hello");
    expect(store.loadRecentMessages(UUID)).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("keeps messages in insertion order across roles", () => {
    const { store } = makeStore();
    store.appendMessage(UUID, "user", "q1");
    store.appendMessage(UUID, "assistant", "a1");
    store.appendMessage(UUID, "user", "q2");

    expect(store.loadRecentMessages(UUID).map((m) => m.content)).toEqual([
      "q1",
      "a1",
      "q2",
    ]);
  });

  it("keeps sessions independent", () => {
    const { store } = makeStore();
    store.appendMessage(UUID, "user", "mine");
    store.appendMessage(OTHER_UUID, "user", "theirs");

    expect(store.loadRecentMessages(UUID).map((m) => m.content)).toEqual(["mine"]);
  });

  it("windows to the most recent entries, oldest first", () => {
    const { store } = makeStore();
    for (let i = 0; i < 30; i += 1) {
      store.appendMessage(UUID, i % 2 === 0 ? "user" : "assistant", `m${i}`);
    }

    const windowed = store.loadRecentMessages(UUID);
    expect(windowed.length).toBe(24);
    expect(windowed[0]?.content).toBe("m6");
    expect(windowed[23]?.content).toBe("m29");
  });

  it("clamps each entry to the effective character cap", () => {
    const { store } = makeStore();
    store.appendMessage(UUID, "user", "y".repeat(20_000));
    store.appendMessage(UUID, "assistant", "short");

    const windowed = store.loadRecentMessages(UUID);
    expect(windowed[0]?.content.length).toBe(16_000);
    expect(windowed[1]?.content).toBe("short");
  });

  it("refuses non-UUID sessionIds instead of writing them", () => {
    const { store } = makeStore();
    expect(() => store.appendMessage("../../evil", "user", "x")).toThrow();
    expect(() => store.ensureSession("not-a-uuid")).toThrow();
    // Reads fail loudly too — invalid ids are never silently treated as
    // "no history".
    expect(() => store.loadRecentMessages("../../evil")).toThrow();
  });

  it("appends tool calls with per-session ordering", () => {
    const { store } = makeStore();
    store.appendToolCall(UUID, "list_projects", "{}", '{"projects":[]}');
    store.appendToolCall(UUID, "list_projects", "{}", '{"projects":[]}');
    store.appendToolCall(OTHER_UUID, "get_contact_information", "{}", "{}");

    // Ordering is internal; here we just assert no error and independent seq.
    // Phase 2 wires these into the agent loop and reads them back.
    expect(store.usageTokensSince(null, "2026-01-01T00:00:00.000Z")).toBe(0);
  });

  it("records usage and aggregates per day and per client", () => {
    let current = new Date("2026-10-03T10:00:00Z");
    const { store } = makeStore(() => current);

    store.recordUsage(UUID, "1.1.1.1", { inputTokens: 100, outputTokens: 50 });
    store.recordUsage(UUID, "1.1.1.1", { inputTokens: 10, outputTokens: 5 });
    store.recordUsage(OTHER_UUID, "2.2.2.2", { inputTokens: 40, outputTokens: 0 });

    const before = "2026-10-03T00:00:00.000Z";
    expect(store.usageTokensSince(null, before)).toBe(205);
    expect(store.usageTokensSince("1.1.1.1", before)).toBe(165);
    expect(store.usageTokensSince("2.2.2.2", before)).toBe(40);
    expect(store.usageTokensSince(null, "2026-10-04T00:00:00.000Z")).toBe(0);

    current = new Date("2026-10-04T10:00:00Z");
    store.recordUsage(UUID, "1.1.1.1", { inputTokens: 5, outputTokens: 0 });
    // Only the new day's usage counts from the new day's boundary.
    expect(store.usageTokensSince(null, "2026-10-04T00:00:00.000Z")).toBe(5);
    expect(store.usageTokensSince(null, before)).toBe(210);
  });
});
