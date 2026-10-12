import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ConversationMessage } from "@portfolio/shared";
import {
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  UUID_PATTERN,
} from "@portfolio/shared";

// Server-side session store backed by SQLite (node:sqlite, no dependency).
// This is the source of truth for what the model sees and for recruiter
// analytics:
//
//   sessions   one row per conversation (keyed by the client-generated UUID)
//   messages   the full transcript, append-only — user/assistant turns now,
//              'summary' rows reserved for compaction (phase 3)
//   tool_calls every tool invocation + result, append-only (wired to the
//              agent loop in phase 2 with the GitHub tool)
//   usage      tokens billed per request — feeds the budget ledger and
//              survives restarts (in-memory counters could not)
//
// Compaction later only ADDS a cached summary + cursor; message rows are
// never rewritten, so analytics always see complete transcripts.
export type SessionStore = {
  ensureSession(sessionId: string): void;
  appendMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
  ): void;
  // The model-facing window: the most recent entries, oldest first, each
  // clamped to MAX_HISTORY_MESSAGE_CHARS. Compaction will replace this with
  // "summary + entries after the cursor" in phase 3.
  loadRecentMessages(sessionId: string): ConversationMessage[];
  dashboardOverview(range: "7d" | "30d" | "all"): DashboardOverview;
  loadConversation(sessionId: string): StoredConversation | null;
  appendToolCall(
    sessionId: string,
    name: string,
    inputJson: string,
    resultJson: string,
  ): void;
  recordUsage(
    sessionId: string,
    clientKey: string,
    usage: { inputTokens: number; outputTokens: number },
  ): void;
  usageTokensSince(clientKey: string | null, sinceIso: string): number;
  close(): void;
};

export type ConversationSummary = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
  latestMessage: string;
};

export type StoredConversation = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    seq: number;
    role: "user" | "assistant" | "summary";
    content: string;
    createdAt: string;
  }>;
};

export type DashboardOverview = {
  totalConversations: number;
  activeConversations: number;
  messagesInRange: number;
  conversations: ConversationSummary[];
};

export function createSessionStore({
  dbPath,
  now = () => new Date(),
}: {
  dbPath: string;
  now?: () => Date;
}): SessionStore {
  const dir = dirname(dbPath);
  if (dir !== "." && dir !== ":memory:") {
    mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'summary')),
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq         INTEGER NOT NULL,
      name        TEXT NOT NULL,
      input_json  TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );

    -- No foreign key on purpose: usage rows must survive session deletion
    -- (retention), because they are the budget ledger's source of truth.
    CREATE TABLE IF NOT EXISTS usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL,
      client_key    TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls (session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_usage_day ON usage (created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_client_day ON usage (client_key, created_at);
  `);

  function assertSessionId(sessionId: string): void {
    // sessionId arrives from the client and is used as a database key. The
    // request schema enforces UUIDs; this guard is defense in depth for any
    // future caller that forgets.
    if (!UUID_PATTERN.test(sessionId)) {
      throw new Error("sessionId must be a UUID");
    }
  }

  const ensureSessionStmt = db.prepare(
    "INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
  );
  const nextSeqStmt = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE session_id = ?",
  );
  const appendMessageStmt = db.prepare(
    "INSERT INTO messages (session_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const recentMessagesStmt = db.prepare(
    "SELECT seq, role, content FROM messages WHERE session_id = ? " +
      "ORDER BY seq DESC LIMIT ?",
  );
  const nextToolSeqStmt = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tool_calls WHERE session_id = ?",
  );
  const appendToolCallStmt = db.prepare(
    "INSERT INTO tool_calls (session_id, seq, name, input_json, result_json, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  );
  const recordUsageStmt = db.prepare(
    "INSERT INTO usage (session_id, client_key, input_tokens, output_tokens, created_at) " +
      "VALUES (?, ?, ?, ?, ?)",
  );
  const usageSinceStmt = db.prepare(
    "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM usage " +
      "WHERE created_at >= ?",
  );
  const usageSinceForClientStmt = db.prepare(
    "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM usage " +
      "WHERE created_at >= ? AND client_key = ?",
  );
  const totalConversationsStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM sessions",
  );
  const countActiveConversationsStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM sessions WHERE updated_at >= ?",
  );
  const countMessagesStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM messages WHERE role IN ('user', 'assistant')",
  );
  const countMessagesSinceStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM messages WHERE role IN ('user', 'assistant') AND created_at >= ?",
  );
  const conversationSummariesAllStmt = db.prepare(`
    SELECT s.id, s.created_at, s.updated_at,
      COUNT(CASE WHEN m.role IN ('user', 'assistant') THEN 1 END) AS message_count,
      (SELECT content FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY seq ASC LIMIT 1) AS title,
      (SELECT content FROM messages WHERE session_id = s.id AND role IN ('user', 'assistant') ORDER BY seq DESC LIMIT 1) AS latest_message
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT ?
  `);
  const conversationSummariesSinceStmt = db.prepare(`
    SELECT s.id, s.created_at, s.updated_at,
      COUNT(CASE WHEN m.role IN ('user', 'assistant') THEN 1 END) AS message_count,
      (SELECT content FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY seq ASC LIMIT 1) AS title,
      (SELECT content FROM messages WHERE session_id = s.id AND role IN ('user', 'assistant') ORDER BY seq DESC LIMIT 1) AS latest_message
    FROM sessions s
    LEFT JOIN messages m ON m.session_id = s.id
    WHERE s.updated_at >= ?
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT ?
  `);
  const conversationMessagesStmt = db.prepare(
    "SELECT seq, role, content, created_at FROM messages WHERE session_id = ? ORDER BY seq ASC",
  );

  function nextSeq(stmt: StatementSync, sessionId: string): number {
    return (stmt.get(sessionId) as { next: number } | undefined)?.next ?? 1;
  }

  function rangeStart(range: "7d" | "30d" | "all"): string | null {
    if (range === "all") {
      return null;
    }
    const days = range === "7d" ? 7 : 30;
    return new Date(now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function summariesFromRows(rows: unknown): ConversationSummary[] {
    return (rows as Array<{
      id: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      title: string | null;
      latest_message: string | null;
    }>).map((row) => ({
      sessionId: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      title: row.title ?? "Conversation",
      latestMessage: row.latest_message ?? "",
    }));
  }

  return {
    ensureSession(sessionId) {
      assertSessionId(sessionId);
      ensureSessionStmt.run(sessionId, now().toISOString(), now().toISOString());
    },

    appendMessage(sessionId, role, content) {
      assertSessionId(sessionId);
      ensureSessionStmt.run(sessionId, now().toISOString(), now().toISOString());
      appendMessageStmt.run(
        sessionId,
        nextSeq(nextSeqStmt, sessionId),
        role,
        content,
        now().toISOString(),
      );
    },

    loadRecentMessages(sessionId) {
      assertSessionId(sessionId);
      const rows = recentMessagesStmt.all(sessionId, MAX_HISTORY_MESSAGES) as Array<{
        seq: number;
        role: string;
        content: string;
      }>;
      // Ordered newest-first by the query; reverse to oldest-first for the
      // model, clamp each entry to the effective cap.
      return rows
        .reverse()
        .map((row) => ({
          role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: row.content.slice(0, MAX_HISTORY_MESSAGE_CHARS),
        }));
    },

    dashboardOverview(range) {
      const since = rangeStart(range);
      const totalConversations = (totalConversationsStmt.get() as { count: number }).count;
      const activeConversations = since
        ? (countActiveConversationsStmt.get(since) as { count: number }).count
        : totalConversations;
      const messagesInRange = since
        ? (countMessagesSinceStmt.get(since) as { count: number }).count
        : (countMessagesStmt.get() as { count: number }).count;
      const rows = since
        ? conversationSummariesSinceStmt.all(since, 100)
        : conversationSummariesAllStmt.all(100);

      return {
        totalConversations,
        activeConversations,
        messagesInRange,
        conversations: summariesFromRows(rows),
      };
    },

    loadConversation(sessionId) {
      assertSessionId(sessionId);
      const rows = conversationMessagesStmt.all(sessionId) as Array<{
        seq: number;
        role: string;
        content: string;
        created_at: string;
      }>;
      if (rows.length === 0) {
        return null;
      }
      const session = db
        .prepare("SELECT created_at, updated_at FROM sessions WHERE id = ?")
        .get(sessionId) as { created_at: string; updated_at: string } | undefined;
      if (!session) {
        return null;
      }
      return {
        sessionId,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        messages: rows.map((row) => ({
          seq: row.seq,
          role: row.role === "assistant" || row.role === "summary" ? row.role : "user",
          content: row.content,
          createdAt: row.created_at,
        })),
      };
    },

    appendToolCall(sessionId, name, inputJson, resultJson) {
      assertSessionId(sessionId);
      ensureSessionStmt.run(sessionId, now().toISOString(), now().toISOString());
      appendToolCallStmt.run(
        sessionId,
        nextSeq(nextToolSeqStmt, sessionId),
        name,
        inputJson,
        resultJson,
        now().toISOString(),
      );
    },

    recordUsage(sessionId, clientKey, usage) {
      recordUsageStmt.run(
        sessionId,
        clientKey,
        usage.inputTokens,
        usage.outputTokens,
        now().toISOString(),
      );
    },

    usageTokensSince(clientKey, sinceIso) {
      const row = clientKey
        ? (usageSinceForClientStmt.get(sinceIso, clientKey) as { tokens: number } | undefined)
        : (usageSinceStmt.get(sinceIso) as { tokens: number } | undefined);
      return row?.tokens ?? 0;
    },

    close() {
      db.close();
    },
  };
}
