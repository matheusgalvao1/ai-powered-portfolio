import { describe, expect, it } from "vitest";
import { createSessionStore } from "./sessionStore.js";
import { createMemoryBudgetLedger, createSqlBudgetLedger } from "./budget.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function memoryLedgerWithClock(overrides: { global?: number; perIp?: number } = {}) {
  let current = new Date("2026-10-03T00:00:00Z");
  const ledger = createMemoryBudgetLedger({
    globalDailyTokens: overrides.global ?? 1000,
    perIpDailyTokens: overrides.perIp ?? 400,
    now: () => current,
  });
  return {
    ledger,
    advanceMs: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

const UUID = "7c9e6679-742f-40de-944b-e07fc1f90ae7";

describe("createMemoryBudgetLedger", () => {
  it("has headroom initially", async () => {
    const { ledger } = memoryLedgerWithClock();
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(true);
  });

  it("blocks a client past its daily budget", async () => {
    const { ledger } = memoryLedgerWithClock();
    await ledger.record("1.1.1.1", UUID, { inputTokens: 250, outputTokens: 150 });

    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(false);
    expect(await ledger.hasHeadroom("2.2.2.2")).toBe(true);
  });

  it("blocks everyone once the global budget is exhausted", async () => {
    const { ledger } = memoryLedgerWithClock({ global: 1000, perIp: 400 });

    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      await ledger.record(ip, UUID, { inputTokens: 400, outputTokens: 0 });
    }

    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(false);
    expect(await ledger.hasHeadroom("2.2.2.2")).toBe(false);
    expect(await ledger.hasHeadroom("9.9.9.9")).toBe(false);
  });

  it("resets both budgets at UTC midnight", async () => {
    const { ledger, advanceMs } = memoryLedgerWithClock();

    await ledger.record("1.1.1.1", UUID, { inputTokens: 400, outputTokens: 0 });
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(false);

    advanceMs(DAY_MS);
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(true);
  });

  it("never reports negative remaining tokens", async () => {
    const { ledger } = memoryLedgerWithClock({ global: 1000 });
    await ledger.record("1.1.1.1", UUID, { inputTokens: 2000, outputTokens: 0 });
    expect(await ledger.remainingGlobalTokens()).toBe(0);
  });

  it("accumulates usage across records for a client", async () => {
    const { ledger } = memoryLedgerWithClock({ perIp: 400 });
    await ledger.record("1.1.1.1", UUID, { inputTokens: 150, outputTokens: 50 });
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(true);
    await ledger.record("1.1.1.1", UUID, { inputTokens: 150, outputTokens: 50 });
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(false);
  });
});

describe("createSqlBudgetLedger", () => {
  function sqlLedger(overrides: { global?: number; perIp?: number } = {}) {
    let current = new Date("2026-10-03T00:00:00Z");
    const store = createSessionStore({ dbPath: ":memory:", now: () => current });
    const ledger = createSqlBudgetLedger({
      store,
      globalDailyTokens: overrides.global ?? 1000,
      perIpDailyTokens: overrides.perIp ?? 400,
      now: () => current,
    });
    return {
      ledger,
      store,
      advanceMs: (ms: number) => {
        current = new Date(current.getTime() + ms);
      },
    };
  }

  it("derives headroom from recorded usage rows", async () => {
    const { ledger } = sqlLedger();
    await ledger.record("1.1.1.1", UUID, { inputTokens: 250, outputTokens: 150 });

    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(false);
    expect(await ledger.hasHeadroom("2.2.2.2")).toBe(true);
  });

  it("enforces the global cap across clients", async () => {
    const { ledger } = sqlLedger({ global: 1000, perIp: 400 });

    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      await ledger.record(ip, UUID, { inputTokens: 400, outputTokens: 0 });
    }

    expect(await ledger.remainingGlobalTokens()).toBe(0);
    expect(await ledger.hasHeadroom("9.9.9.9")).toBe(false);
  });

  it("resets at UTC midnight because the day filter moves", async () => {
    const { ledger, advanceMs } = sqlLedger();

    await ledger.record("1.1.1.1", UUID, { inputTokens: 400, outputTokens: 0 });
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(false);

    // No rows are deleted — the ledger simply stops counting yesterday's
    // usage, which is what makes budgets survive restarts.
    advanceMs(DAY_MS);
    expect(await ledger.hasHeadroom("1.1.1.1")).toBe(true);
  });

  it("budgets survive a restart: a fresh ledger over the same file keeps the spend", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "budget-"));
    const dbPath = join(dir, "sessions.db");
    try {
      const first = createSessionStore({ dbPath });
      const firstLedger = createSqlBudgetLedger({
        store: first,
        globalDailyTokens: 1000,
        perIpDailyTokens: 400,
      });
      await firstLedger.record("1.1.1.1", UUID, { inputTokens: 300, outputTokens: 100 });
      await first.close();

      const second = createSessionStore({ dbPath });
      const secondLedger = createSqlBudgetLedger({
        store: second,
        globalDailyTokens: 1000,
        perIpDailyTokens: 400,
      });
      expect(await secondLedger.hasHeadroom("1.1.1.1")).toBe(false);
      expect(await secondLedger.remainingGlobalTokens()).toBe(600);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
