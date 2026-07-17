import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class SessionRecorder {
  constructor({ sessionsDir }) {
    this.sessionsDir = sessionsDir;
    mkdirSync(sessionsDir, { recursive: true });
  }

  recordTurn(sessionId, { requestId, message, answer }) {
    const entry = {
      sessionId,
      requestId,
      timestamp: new Date().toISOString(),
      message,
      answer,
    };

    appendFileSync(
      join(this.sessionsDir, `${sessionId}.jsonl`),
      `${JSON.stringify(entry)}\n`,
    );
  }
}
