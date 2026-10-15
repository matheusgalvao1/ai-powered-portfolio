import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { ChatStreamEvent } from "@portfolio/shared";
import { MAX_PDF_PAGES } from "@portfolio/shared";
import { createSessionStore } from "../sessionStore.js";
import { createMemoryBudgetLedger, createSqlBudgetLedger } from "../budget.js";
import { createChatService } from "./chatService.js";
import type { PortfolioAgent } from "../agent.js";
import type { AgentState } from "@portfolio/agent";

const UUID = "7c9e6679-742f-40de-944b-e07fc1f90ae7";
const INTERRUPTED_MARKER = "[The user stopped this response before it was finished.]";
const FAILED_MARKER = "[The assistant failed to complete this response.]";

function completeState(): AgentState {
  return {
    status: "complete",
    steps: 1,
    toolCallsUsed: 0,
    messages: [],
    answer: "ok",
    truncated: false,
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

type Harness = {
  service: ReturnType<typeof createChatService>;
  events: ChatStreamEvent[];
  agentRun: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof createSessionStore>;
  ledgerHasHeadroom: ReturnType<typeof vi.fn>;
};

function makeService(
  agentState: AgentState = completeState(),
  supportsPdfInput = true,
): Harness {
  const events: ChatStreamEvent[] = [];
  const agentRun = vi.fn(async () => agentState);
  const ledgerHasHeadroom = vi.fn(async () => true);

  const store = createSessionStore({ dbPath: ":memory:" });
  const ledger = {
    ...createMemoryBudgetLedger({ globalDailyTokens: 1_000_000, perIpDailyTokens: 200_000 }),
    hasHeadroom: ledgerHasHeadroom,
  };

  const service = createChatService({
    agent: { run: agentRun, supportsPdfInput } as unknown as PortfolioAgent,
    store,
    ledger,
  });

  return { service, events, agentRun, store, ledgerHasHeadroom };
}

const emit = (events: ChatStreamEvent[]) => (event: ChatStreamEvent) => events.push(event);

async function makePdfBase64(pageCount = 1): Promise<string> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) {
    document.addPage();
  }
  return Buffer.from(await document.save()).toString("base64");
}

describe("createChatService", () => {
  it("persists the question and the answer, then signals complete", async () => {
    const harness = makeService();

    await harness.service.streamChat(
      { message: "hi", clientKey: "1.1.1.1", sessionId: UUID },
      emit(harness.events),
    );

    expect(await harness.store.loadRecentMessages(UUID)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ]);
    expect(harness.events).toEqual([
      expect.objectContaining({ type: "start", sessionId: UUID }),
      { type: "complete" },
    ]);
  });

  it("feeds prior stored history to the agent", async () => {
    const harness = makeService();
    await harness.store.appendMessage(UUID, "user", "earlier question");
    await harness.store.appendMessage(UUID, "assistant", "earlier answer");

    await harness.service.streamChat(
      { message: "follow-up", clientKey: "1.1.1.1", sessionId: UUID },
      emit(harness.events),
    );

    const history = harness.agentRun.mock.calls[0]?.[1] as Array<{ content: string }>;
    expect(history).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ]);
    expect(harness.agentRun.mock.calls[0]?.[0]).toBe("follow-up");
  });

  it("emits BUDGET_EXHAUSTED, runs no agent, and persists nothing", async () => {
    const harness = makeService();
    harness.ledgerHasHeadroom.mockReturnValue(false);

    await harness.service.streamChat(
      { message: "hi", clientKey: "1.1.1.1", sessionId: UUID },
      emit(harness.events),
    );

    expect(harness.agentRun).not.toHaveBeenCalled();
    expect(await harness.store.loadRecentMessages(UUID)).toEqual([]);
    expect(harness.events).toEqual([
      {
        type: "error",
        code: "BUDGET_EXHAUSTED",
        message: expect.stringContaining("daily usage limit"),
      },
    ]);
  });

  it("records usage with the client key and session id", async () => {
    let current = new Date("2026-10-03T10:00:00Z");
    const events: ChatStreamEvent[] = [];
    const store = createSessionStore({ dbPath: ":memory:", now: () => current });
    const ledger = createSqlBudgetLedger({
      store,
      globalDailyTokens: 1_000_000,
      perIpDailyTokens: 200_000,
      now: () => current,
    });
    const agentRun = vi.fn(async () => completeState());
    const service = createChatService({
      agent: { run: agentRun, supportsPdfInput: true } as unknown as PortfolioAgent,
      store,
      ledger,
    });

    await service.streamChat(
      { message: "hi", clientKey: "1.1.1.1", sessionId: UUID },
      (event) => events.push(event),
    );

    expect(await store.usageTokensSince("1.1.1.1", "2026-10-03T00:00:00.000Z")).toBe(15);
  });

  it("keeps the transcript consistent when the client aborts", async () => {
    const harness = makeService();
    harness.agentRun.mockImplementation(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    await harness.service.streamChat(
      { message: "hi", clientKey: "1.1.1.1", sessionId: UUID },
      emit(harness.events),
    );

    expect(await harness.store.loadRecentMessages(UUID)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: INTERRUPTED_MARKER },
    ]);
    expect(harness.events.some((event) => event.type === "error")).toBe(false);
  });

  it("stores a failure marker when the agent hits the iteration cap", async () => {
    const state = completeState();
    state.status = "max_steps";
    const harness = makeService(state);

    await harness.service.streamChat(
      { message: "hi", clientKey: "1.1.1.1", sessionId: UUID },
      emit(harness.events),
    );

    expect(await harness.store.loadRecentMessages(UUID)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: FAILED_MARKER },
    ]);
    expect(harness.events.some((event) => event.type === "error")).toBe(true);
  });

  it("records the attachment note in the stored question", async () => {
    const harness = makeService();
    await harness.service.streamChat(
      {
        message: "look",
        clientKey: "1.1.1.1",
        sessionId: UUID,
        attachments: [
          { id: "a1", name: "jd.txt", mimeType: "text/plain", data: "aGVsbG8=" },
        ],
      },
      emit(harness.events),
    );

    const stored = await harness.store.loadRecentMessages(UUID);
    expect(stored[0]?.content).toContain("[Attached files: jd.txt (text/plain)]");
  });

  it("passes a validated PDF to the agent but stores only its attachment note", async () => {
    const harness = makeService();
    const data = await makePdfBase64();

    await harness.service.streamChat(
      {
        message: "Summarize this",
        clientKey: "1.1.1.1",
        sessionId: UUID,
        attachments: [{ id: "pdf1", name: "report.pdf", mimeType: "application/pdf", data }],
      },
      emit(harness.events),
    );

    expect(harness.agentRun.mock.calls[0]?.[2]).toEqual([
      { name: "report.pdf", mimeType: "application/pdf", data },
    ]);
    const stored = await harness.store.loadRecentMessages(UUID);
    expect(stored[0]?.content).toContain("[Attached files: report.pdf (application/pdf)]");
    expect(stored[0]?.content).not.toContain(data);
  });

  it("rejects invalid PDFs before persisting or calling the agent", async () => {
    const harness = makeService();

    await harness.service.streamChat(
      {
        message: "Summarize this",
        clientKey: "1.1.1.1",
        sessionId: UUID,
        attachments: [
          {
            id: "pdf1",
            name: "broken.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("not a PDF").toString("base64"),
          },
        ],
      },
      emit(harness.events),
    );

    expect(harness.agentRun).not.toHaveBeenCalled();
    expect(await harness.store.loadRecentMessages(UUID)).toEqual([]);
    expect(harness.events).toEqual([
      expect.objectContaining({ type: "error", code: "VALIDATION_ERROR" }),
    ]);
  });

  it("rejects over-page-limit PDFs before persisting or calling the agent", async () => {
    const harness = makeService();

    await harness.service.streamChat(
      {
        message: "Summarize this",
        clientKey: "1.1.1.1",
        sessionId: UUID,
        attachments: [
          {
            id: "pdf1",
            name: "long-report.pdf",
            mimeType: "application/pdf",
            data: await makePdfBase64(MAX_PDF_PAGES + 1),
          },
        ],
      },
      emit(harness.events),
    );

    expect(harness.agentRun).not.toHaveBeenCalled();
    expect(await harness.store.loadRecentMessages(UUID)).toEqual([]);
    expect(harness.events).toEqual([
      expect.objectContaining({ type: "error", code: "VALIDATION_ERROR" }),
    ]);
  });

  it("rejects PDFs when the configured model does not support native file input", async () => {
    const harness = makeService(completeState(), false);

    await harness.service.streamChat(
      {
        message: "Summarize this",
        clientKey: "1.1.1.1",
        sessionId: UUID,
        attachments: [
          { id: "pdf1", name: "report.pdf", mimeType: "application/pdf", data: "JVBERi0x" },
        ],
      },
      emit(harness.events),
    );

    expect(harness.agentRun).not.toHaveBeenCalled();
    expect(await harness.store.loadRecentMessages(UUID)).toEqual([]);
    expect(harness.events).toEqual([
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("OPENROUTER_MODEL_ID=~openai/gpt-luna-latest"),
      }),
    ]);
  });
});
