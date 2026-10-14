import { Pool } from "pg";
import {
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  UUID_PATTERN,
} from "@portfolio/shared";
import type {
  ConversationSummary,
  DashboardOverview,
  SessionStore,
  StoredConversation,
} from "./sessionStore.js";

type QueryRow = {
  id?: string;
  session_id?: string;
  seq?: string | number;
  role?: string;
  content?: string;
  created_at?: string;
  updated_at?: string;
  message_count?: string | number;
  title?: string | null;
  latest_message?: string | null;
  count?: string | number;
  tokens?: string | number;
};

function numberValue(value: string | number | undefined): number {
  return Number(value ?? 0);
}

function assertSessionId(sessionId: string): void {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new Error("sessionId must be a UUID");
  }
}

function sslFor(connectionString: string) {
  const { hostname } = new URL(connectionString);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    ? false
    : { rejectUnauthorized: true };
}

export function createPostgresSessionStore({
  connectionString,
  maxConnections = 4,
  now = () => new Date(),
}: {
  connectionString: string;
  maxConnections?: number;
  now?: () => Date;
}): SessionStore {
  const pool = new Pool({
    connectionString,
    max: maxConnections,
    ssl: sslFor(connectionString),
    application_name: "matheus-portfolio-api",
  });

  async function ensureSessionRow(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
    const timestamp = now().toISOString();
    await pool.query(
      `INSERT INTO sessions (id, created_at, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [sessionId, timestamp, timestamp],
    );
  }

  function rangeStart(range: "7d" | "30d" | "all"): string | null {
    if (range === "all") return null;
    const days = range === "7d" ? 7 : 30;
    return new Date(now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  async function loadSummaries(since: string | null): Promise<ConversationSummary[]> {
    const query = `
      SELECT s.id, s.created_at, s.updated_at,
        COUNT(m.seq) FILTER (WHERE m.role IN ('user', 'assistant')) AS message_count,
        (SELECT content FROM messages WHERE session_id = s.id AND role = 'user'
          ORDER BY seq ASC LIMIT 1) AS title,
        (SELECT content FROM messages WHERE session_id = s.id AND role IN ('user', 'assistant')
          ORDER BY seq DESC LIMIT 1) AS latest_message
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      ${since ? "WHERE s.updated_at >= $1" : ""}
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT ${since ? "$2" : "$1"}`;
    const { rows } = await pool.query<QueryRow>(query, since ? [since, 100] : [100]);
    return rows.map((row) => ({
      sessionId: row.id!,
      createdAt: row.created_at!,
      updatedAt: row.updated_at!,
      messageCount: numberValue(row.message_count),
      title: row.title ?? "Conversation",
      latestMessage: row.latest_message ?? "",
    }));
  }

  return {
    async ensureSession(sessionId) {
      await ensureSessionRow(sessionId);
    },

    async appendMessage(sessionId, role, content) {
      assertSessionId(sessionId);
      const timestamp = now().toISOString();
      await pool.query(
        `WITH allocated AS (
           INSERT INTO sessions (id, created_at, updated_at, next_message_seq)
           VALUES ($1, $2, $2, 2)
           ON CONFLICT (id) DO UPDATE
             SET updated_at = EXCLUDED.updated_at,
                 next_message_seq = sessions.next_message_seq + 1
           RETURNING id, next_message_seq - 1 AS seq
         )
         INSERT INTO messages (session_id, seq, role, content, created_at)
         SELECT id, seq, $3, $4, $5 FROM allocated`,
        [sessionId, timestamp, role, content, timestamp],
      );
    },

    async loadRecentMessages(sessionId) {
      assertSessionId(sessionId);
      const { rows } = await pool.query<QueryRow>(
        "SELECT role, content FROM messages WHERE session_id = $1 ORDER BY seq DESC LIMIT $2",
        [sessionId, MAX_HISTORY_MESSAGES],
      );
      return rows.reverse().map((row) => ({
        role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: row.content!.slice(0, MAX_HISTORY_MESSAGE_CHARS),
      }));
    },

    async dashboardOverview(range) {
      const since = rangeStart(range);
      const [totalResult, activeResult, messagesResult, conversations] = await Promise.all([
        pool.query<QueryRow>("SELECT COUNT(*) AS count FROM sessions"),
        since
          ? pool.query<QueryRow>("SELECT COUNT(*) AS count FROM sessions WHERE updated_at >= $1", [since])
          : pool.query<QueryRow>("SELECT COUNT(*) AS count FROM sessions"),
        since
          ? pool.query<QueryRow>(
              "SELECT COUNT(*) AS count FROM messages WHERE role IN ('user', 'assistant') AND created_at >= $1",
              [since],
            )
          : pool.query<QueryRow>(
              "SELECT COUNT(*) AS count FROM messages WHERE role IN ('user', 'assistant')",
            ),
        loadSummaries(since),
      ]);
      return {
        totalConversations: numberValue(totalResult.rows[0]?.count),
        activeConversations: numberValue(activeResult.rows[0]?.count),
        messagesInRange: numberValue(messagesResult.rows[0]?.count),
        conversations,
      } satisfies DashboardOverview;
    },

    async loadConversation(sessionId) {
      assertSessionId(sessionId);
      const [sessionResult, messagesResult] = await Promise.all([
        pool.query<QueryRow>("SELECT created_at, updated_at FROM sessions WHERE id = $1", [sessionId]),
        pool.query<QueryRow>(
          "SELECT seq, role, content, created_at FROM messages WHERE session_id = $1 ORDER BY seq ASC",
          [sessionId],
        ),
      ]);
      const session = sessionResult.rows[0];
      if (!session || messagesResult.rows.length === 0) return null;
      return {
        sessionId,
        createdAt: session.created_at!,
        updatedAt: session.updated_at!,
        messages: messagesResult.rows.map((row) => ({
          seq: numberValue(row.seq),
          role:
            row.role === "assistant" || row.role === "summary"
              ? row.role
              : ("user" as const),
          content: row.content!,
          createdAt: row.created_at!,
        })),
      } satisfies StoredConversation;
    },

    async appendToolCall(sessionId, name, inputJson, resultJson) {
      assertSessionId(sessionId);
      const timestamp = now().toISOString();
      await pool.query(
        `WITH allocated AS (
           INSERT INTO sessions (id, created_at, updated_at, next_tool_call_seq)
           VALUES ($1, $2, $2, 2)
           ON CONFLICT (id) DO UPDATE
             SET updated_at = EXCLUDED.updated_at,
                 next_tool_call_seq = sessions.next_tool_call_seq + 1
           RETURNING id, next_tool_call_seq - 1 AS seq
         )
         INSERT INTO tool_calls (session_id, seq, name, input_json, result_json, created_at)
         SELECT id, seq, $3, $4, $5, $6 FROM allocated`,
        [sessionId, timestamp, name, inputJson, resultJson, timestamp],
      );
    },

    async recordUsage(sessionId, clientKey, usage) {
      await pool.query(
        `INSERT INTO usage (session_id, client_key, input_tokens, output_tokens, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, clientKey, usage.inputTokens, usage.outputTokens, now().toISOString()],
      );
    },

    async usageTokensSince(clientKey, sinceIso) {
      const result = clientKey
        ? await pool.query<QueryRow>(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM usage WHERE created_at >= $1 AND client_key = $2",
            [sinceIso, clientKey],
          )
        : await pool.query<QueryRow>(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM usage WHERE created_at >= $1",
            [sinceIso],
          );
      return numberValue(result.rows[0]?.tokens);
    },

    async close() {
      await pool.end();
    },
  };
}
