import { DatabaseSync } from "node:sqlite";
import { Client } from "pg";
import { migratePostgres } from "../src/postgresMigrations.js";

const sqlitePath = process.env.SQLITE_DB_PATH;
const connectionString = process.env.DATABASE_URL;
if (!sqlitePath || !connectionString || process.env.ALLOW_DATABASE_IMPORT !== "YES") {
  throw new Error(
    "Set SQLITE_DB_PATH, DATABASE_URL, and ALLOW_DATABASE_IMPORT=YES to run the importer",
  );
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pg = new Client({
  connectionString,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(connectionString).hostname)
    ? false
    : { rejectUnauthorized: true },
  application_name: "matheus-portfolio-sqlite-import",
});

function rows<T>(sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

await migratePostgres(connectionString);
await pg.connect();

try {
  const tableNames = ["sessions", "messages", "tool_calls", "usage"] as const;
  const counts: number[] = [];
  for (const table of tableNames) {
    const result = await pg.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${table}`);
    counts.push(Number(result.rows[0]?.count ?? 0));
  }
  if (counts.some((count) => count !== 0)) {
    throw new Error("Import destination must be empty; refusing to overwrite or merge data");
  }

  sqlite.exec("BEGIN");
  const sessions = rows<{
    id: string;
    created_at: string;
    updated_at: string;
    next_message_seq: number;
    next_tool_call_seq: number;
  }>(`SELECT s.id, s.created_at, s.updated_at,
        COALESCE((SELECT MAX(seq) FROM messages WHERE session_id = s.id), 0) + 1 AS next_message_seq,
        COALESCE((SELECT MAX(seq) FROM tool_calls WHERE session_id = s.id), 0) + 1 AS next_tool_call_seq
      FROM sessions s`);
  const messages = rows<{
    session_id: string;
    seq: number;
    role: string;
    content: string;
    created_at: string;
  }>("SELECT session_id, seq, role, content, created_at FROM messages ORDER BY rowid");
  const toolCalls = rows<{
    session_id: string;
    seq: number;
    name: string;
    input_json: string;
    result_json: string;
    created_at: string;
  }>(
    "SELECT session_id, seq, name, input_json, result_json, created_at FROM tool_calls ORDER BY rowid",
  );
  const usage = rows<{
    id: number;
    session_id: string;
    client_key: string;
    input_tokens: number;
    output_tokens: number;
    created_at: string;
  }>("SELECT id, session_id, client_key, input_tokens, output_tokens, created_at FROM usage ORDER BY id");
  sqlite.exec("COMMIT");

  await pg.query("BEGIN");
  try {
    for (const row of sessions) {
      await pg.query(
        `INSERT INTO sessions
          (id, created_at, updated_at, next_message_seq, next_tool_call_seq)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, row.created_at, row.updated_at, row.next_message_seq, row.next_tool_call_seq],
      );
    }
    for (const row of messages) {
      await pg.query(
        "INSERT INTO messages (session_id, seq, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
        [row.session_id, row.seq, row.role, row.content, row.created_at],
      );
    }
    for (const row of toolCalls) {
      await pg.query(
        `INSERT INTO tool_calls (session_id, seq, name, input_json, result_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.session_id, row.seq, row.name, row.input_json, row.result_json, row.created_at],
      );
    }
    for (const row of usage) {
      await pg.query(
        `INSERT INTO usage (id, session_id, client_key, input_tokens, output_tokens, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, row.session_id, row.client_key, row.input_tokens, row.output_tokens, row.created_at],
      );
    }

    for (const [table, column] of [["usage", "id"]] as const) {
      const sequenceResult = await pg.query<{ sequence: string | null }>(
        "SELECT pg_get_serial_sequence($1, $2) AS sequence",
        [table, column],
      );
      const sequence = sequenceResult.rows[0]?.sequence;
      if (sequence) {
        // Sequence names are returned by Postgres, quote them as identifiers.
        const quotedSequence = sequence.split(".").map((part) => `"${part.replaceAll('"', '""')}"`).join(".");
        await pg.query(
          `SELECT setval($1::regclass, COALESCE((SELECT MAX(${column}) FROM ${table}), 1), EXISTS (SELECT 1 FROM ${table}))`,
          [quotedSequence],
        );
      }
    }
    await pg.query("COMMIT");
  } catch (error) {
    await pg.query("ROLLBACK");
    throw error;
  }

  console.log(
    `Imported ${sessions.length} sessions, ${messages.length} messages, ${toolCalls.length} tool calls, and ${usage.length} usage rows.`,
  );
} finally {
  sqlite.close();
  await pg.end();
}
