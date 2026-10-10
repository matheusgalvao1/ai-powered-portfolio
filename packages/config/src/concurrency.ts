// Concurrent in-flight SSE streams. Each held-open turn can drive several
// upstream model calls (agent iterations), so concurrency needs its own cap
// on top of the request rate limit — 20 parallel streams would otherwise mean
// up to 100 simultaneous OpenRouter calls.
export const concurrencyConfig = {
  maxPerIp: process.env.MAX_CONCURRENT_PER_IP
    ? Number(process.env.MAX_CONCURRENT_PER_IP)
    : 3,
  maxGlobal: process.env.MAX_CONCURRENT_GLOBAL
    ? Number(process.env.MAX_CONCURRENT_GLOBAL)
    : 20,
};
