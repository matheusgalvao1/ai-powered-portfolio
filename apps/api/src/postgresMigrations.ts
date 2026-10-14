import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const migrationDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

function assertDirectConnection(connectionString: string): void {
  const hostname = new URL(connectionString).hostname;
  if (hostname.includes("-pooler")) {
    throw new Error("Database migrations require a direct, non-pooled PostgreSQL URL");
  }
}

function sslFor(connectionString: string) {
  const { hostname } = new URL(connectionString);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    ? false
    : { rejectUnauthorized: true };
}

export async function migratePostgres(connectionString: string): Promise<void> {
  assertDirectConnection(connectionString);
  const client = new Client({
    connectionString,
    ssl: sslFor(connectionString),
    application_name: "matheus-portfolio-migrations",
  });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock(824193710)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (alreadyApplied.rowCount) continue;

      const sql = await readFile(join(migrationDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
          [file, new Date().toISOString()],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(824193710)");
    await client.end();
  }
}
