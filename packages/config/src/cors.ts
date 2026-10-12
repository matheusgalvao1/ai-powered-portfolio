const configuredOrigins =
  process.env.ALLOWED_ORIGINS ??
  process.env.ALLOWED_ORIGIN ??
  "http://localhost:3000";

export const corsConfig = {
  allowedOrigins: configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
