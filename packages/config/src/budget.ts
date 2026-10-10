// Daily token budgets for the chat circuit breaker. Counters live in SQLite
// (the session store's usage table), so they survive restarts and are
// queryable. Reset at UTC midnight. The global cap bounds the worst-case
// bill (~$1–3/day on flash-class models); the per-client cap stops one IP
// from burning it all in a minute.
export const budgetConfig = {
  globalDailyTokens: process.env.DAILY_GLOBAL_TOKEN_BUDGET
    ? Number(process.env.DAILY_GLOBAL_TOKEN_BUDGET)
    : 1_000_000,
  perIpDailyTokens: process.env.DAILY_PER_IP_TOKEN_BUDGET
    ? Number(process.env.DAILY_PER_IP_TOKEN_BUDGET)
    : 200_000,
};
