import type { SessionStore } from "./sessionStore.js";

// Daily token ledger backing the chat circuit breaker. Two implementations:
//
//  - createSqlBudgetLedger: production. Counters are the session store's
//    usage table — they survive restarts and are queryable alongside
//    recruiter conversations.
//  - createMemoryBudgetLedger: kept for tests and as a zero-dependency
//    fallback; resets on restart (documented in docs/abuse-proofing-plan.md).
//
// Both reset at UTC midnight and share the same semantics: the per-client
// cap stops one IP from burning the global budget in a minute; the global
// cap bounds the worst-case bill.
export type BudgetLedger = {
  // Whether the client — and the world — still has budget headroom for a new
  // model call. Checked before the agent runs; usage is recorded after.
  hasHeadroom(clientKey: string): Promise<boolean>;
  record(
    clientKey: string,
    sessionId: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void>;
  remainingGlobalTokens(): Promise<number>;
};

// Rotation of spoofed client IPs can grow the per-client map all day; past
// this point it is cleared. That only loosens the per-client budget, never
// the global one.
const MAX_TRACKED_CLIENTS = 50_000;

function utcDayStartIso(now: () => Date): string {
  return `${now().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

export function createSqlBudgetLedger({
  store,
  globalDailyTokens,
  perIpDailyTokens,
  now = () => new Date(),
}: {
  store: SessionStore;
  globalDailyTokens: number;
  perIpDailyTokens: number;
  now?: () => Date;
}): BudgetLedger {
  return {
    async hasHeadroom(clientKey) {
      const since = utcDayStartIso(now);
      const [globalTokens, clientTokens] = await Promise.all([
        store.usageTokensSince(null, since),
        store.usageTokensSince(clientKey, since),
      ]);
      return (
        globalTokens < globalDailyTokens && clientTokens < perIpDailyTokens
      );
    },

    async record(clientKey, sessionId, usage) {
      await store.recordUsage(sessionId, clientKey, usage);
    },

    async remainingGlobalTokens() {
      const used = await store.usageTokensSince(null, utcDayStartIso(now));
      return Math.max(0, globalDailyTokens - used);
    },
  };
}

export function createMemoryBudgetLedger({
  globalDailyTokens,
  perIpDailyTokens,
  now = () => new Date(),
}: {
  globalDailyTokens: number;
  perIpDailyTokens: number;
  now?: () => Date;
}): BudgetLedger {
  let day = now().toISOString().slice(0, 10);
  let globalTokens = 0;
  const perClient = new Map<string, number>();

  function rollDayIfNeeded(): void {
    const today = now().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      globalTokens = 0;
      perClient.clear();
    }
  }

  return {
    async hasHeadroom(clientKey) {
      rollDayIfNeeded();
      const clientTokens = perClient.get(clientKey) ?? 0;
      return globalTokens < globalDailyTokens && clientTokens < perIpDailyTokens;
    },

    async record(clientKey, _sessionId, usage) {
      rollDayIfNeeded();
      const tokens = usage.inputTokens + usage.outputTokens;
      globalTokens += tokens;
      perClient.set(clientKey, (perClient.get(clientKey) ?? 0) + tokens);

      if (perClient.size > MAX_TRACKED_CLIENTS) {
        perClient.clear();
      }
    },

    async remainingGlobalTokens() {
      rollDayIfNeeded();
      return Math.max(0, globalDailyTokens - globalTokens);
    },
  };
}
