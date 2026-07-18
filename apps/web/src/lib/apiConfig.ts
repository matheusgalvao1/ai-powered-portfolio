export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

// Not a real secret once it ships in the built bundle — see
// packages/config/src/apiKey.ts for what this is actually for.
export const API_KEY = import.meta.env.VITE_API_KEY;
