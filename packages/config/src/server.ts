// Number of reverse proxies in front of the API (e.g. 1 for Cloudflare or an
// nginx box). Required in production for correct client IPs: without it,
// req.ip is the proxy's address (everyone shares one rate-limit bucket), and
// direct connections can spoof X-Forwarded-For to rotate rate-limit buckets.
// When this is set, the origin should also firewall down to the proxy's IP
// ranges so direct connections can't forge headers.
export const serverConfig = {
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : undefined,
  // SQLite file for the session store (conversations, tool calls, usage).
  // Must sit on a persistent volume in production (see deploy/fly.toml).
  sessionDbPath: process.env.SESSION_DB_PATH ?? "./data/sessions.db",
};
