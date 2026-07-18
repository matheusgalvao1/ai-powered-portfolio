import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class SessionRecorder {
  private sessionsDir: string;

  constructor({ sessionsDir }: { sessionsDir: string }) {
    this.sessionsDir = sessionsDir;
    mkdirSync(sessionsDir, { recursive: true });
  }

  recordTurn(
    sessionId: string,
    {
      requestId,
      message,
      answer,
    }: { requestId: string; message: string; answer: string },
  ): void {
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
