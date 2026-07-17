import { randomUUID } from "node:crypto";

export function createSessionId() {
  return randomUUID();
}
