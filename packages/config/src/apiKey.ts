// Not user authentication (the PRD explicitly excludes that — recruiters
// never sign in). This is a shared secret between apps/web and apps/api to
// filter out casual abuse/bots hitting the endpoint directly, on top of
// CORS. It's not a real secret once it ships in the built web bundle —
// anyone can read it from devtools — so it deters naive abuse, not a
// motivated attacker. Undefined by default so local dev works with zero
// extra required config.
export const apiKeyConfig = {
  apiKey: process.env.API_KEY,
};
