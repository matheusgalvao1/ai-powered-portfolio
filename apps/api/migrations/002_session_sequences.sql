ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS next_message_seq BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_tool_call_seq BIGINT NOT NULL DEFAULT 1;

UPDATE sessions AS s
SET next_message_seq = COALESCE(
      (SELECT MAX(seq) FROM messages WHERE session_id = s.id), 0
    ) + 1,
    next_tool_call_seq = COALESCE(
      (SELECT MAX(seq) FROM tool_calls WHERE session_id = s.id), 0
    ) + 1;
