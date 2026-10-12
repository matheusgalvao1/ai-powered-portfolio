import { useEffect, useState } from "react";
import { API_BASE_URL } from "../lib/apiConfig.js";

type DashboardRange = "7d" | "30d" | "all";

type ConversationSummary = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title: string;
  latestMessage: string;
};

type DashboardOverview = {
  totalConversations: number;
  activeConversations: number;
  messagesInRange: number;
  conversations: ConversationSummary[];
};

type StoredConversation = {
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

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (!Number.isFinite(elapsed)) {
    return "Unknown";
  }
  if (elapsed < 60_000) {
    return "Just now";
  }
  if (elapsed < 60 * 60_000) {
    return `${Math.floor(elapsed / 60_000)}m ago`;
  }
  if (elapsed < 24 * 60 * 60_000) {
    return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  }
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`;
}

export function AdminDashboard() {
  const [range, setRange] = useState<DashboardRange>("7d");
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<StoredConversation | null>(null);
  const [query, setQuery] = useState("");
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingOverview(true);
    setError(null);

    void fetch(`${API_BASE_URL}/admin/overview?range=${range}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Dashboard request failed (${response.status})`);
        }
        return (await response.json()) as DashboardOverview;
      })
      .then((data) => {
        setOverview(data);
        setSelectedId((current) =>
          current && data.conversations.some((item) => item.sessionId === current)
            ? current
            : null,
        );
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === "AbortError") {
          return;
        }
        setError(
          "Could not load the chat archive. Check the API and Cloudflare Access configuration.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingOverview(false);
        }
      });

    return () => controller.abort();
  }, [range, refreshVersion]);

  useEffect(() => {
    if (!selectedId) {
      setTranscript(null);
      return;
    }

    const controller = new AbortController();
    setLoadingTranscript(true);
    setTranscript(null);

    void fetch(`${API_BASE_URL}/admin/conversations/${selectedId}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Transcript request failed (${response.status})`);
        }
        return (await response.json()) as StoredConversation;
      })
      .then(setTranscript)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof Error && requestError.name === "AbortError")) {
          setError("Could not load this conversation transcript.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingTranscript(false);
        }
      });

    return () => controller.abort();
  }, [selectedId, refreshVersion]);

  const filteredConversations = (overview?.conversations ?? []).filter((item) => {
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      item.title.toLowerCase().includes(needle) ||
      item.latestMessage.toLowerCase().includes(needle)
    );
  });
  const selectedSummary = overview?.conversations.find(
    (item) => item.sessionId === selectedId,
  );

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-brand" href="/" aria-label="Back to the portfolio chat">
          <span className="admin-brand-mark" aria-hidden="true">M</span>
          <span>Matheus Galvao</span>
        </a>
        <div className="admin-environment">
          <span className="admin-live-dot" />
          {import.meta.env.DEV ? "Local archive" : "Protected archive"}
          <span className="admin-environment-divider">/</span>
          SQLite
        </div>
      </header>

      <section className="admin-intro">
        <div>
          <p className="admin-eyebrow">Private workspace <span>01 / 01</span></p>
          <h1>Conversation activity</h1>
          <p className="admin-subtitle">
            A quiet view of the questions reaching your portfolio assistant.
          </p>
        </div>
        <button
          className="admin-refresh"
          type="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
          disabled={loadingOverview}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13 8a5 5 0 0 1-8.7 3.35M3 8a5 5 0 0 1 8.7-3.35M3.2 11.3V8.5m0 2.8H6m6.8-6.6v2.8M12.8 4.7H10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Refresh
        </button>
      </section>

      <section className="admin-metrics" aria-label="Conversation metrics">
        <article className="admin-metric">
          <span className="admin-metric-label">Total conversations</span>
          <strong>{loadingOverview ? "--" : overview?.totalConversations ?? 0}</strong>
          <span className="admin-metric-note">Across this local database</span>
        </article>
        <article className="admin-metric">
          <span className="admin-metric-label">Active in {range === "all" ? "total" : range === "7d" ? "7 days" : "30 days"}</span>
          <strong>{loadingOverview ? "--" : overview?.activeConversations ?? 0}</strong>
          <span className="admin-metric-note">Conversations with recent activity</span>
        </article>
        <article className="admin-metric">
          <span className="admin-metric-label">Messages in range</span>
          <strong>{loadingOverview ? "--" : overview?.messagesInRange ?? 0}</strong>
          <span className="admin-metric-note">User and assistant messages</span>
        </article>
      </section>

      {error ? <div className="admin-error" role="alert">{error}</div> : null}

      <section className={`admin-browser${selectedId ? " has-selection" : ""}`}>
        <div className="admin-list-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="admin-eyebrow">Archive</p>
              <h2>Recent conversations</h2>
            </div>
            <span className="admin-result-count">
              {loadingOverview ? "..." : filteredConversations.length.toString().padStart(2, "0")}
            </span>
          </div>

          <div className="admin-toolbar">
            <label className="admin-search">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.25" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
              <input
                aria-label="Search conversations"
                placeholder="Search messages"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="admin-range" aria-label="Activity period">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={range === option.value ? "active" : ""}
                  aria-pressed={range === option.value}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-conversation-list">
            {loadingOverview ? (
              <p className="admin-empty">Reading the local archive…</p>
            ) : filteredConversations.length === 0 ? (
              <div className="admin-empty-state">
                <span className="admin-empty-mark" aria-hidden="true">—</span>
                <p>{query ? "No conversations match that search." : "No conversations in this period."}</p>
              </div>
            ) : (
              filteredConversations.map((conversation) => (
                <button
                  key={conversation.sessionId}
                  className={`admin-conversation${selectedId === conversation.sessionId ? " selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedId(conversation.sessionId)}
                >
                  <span className="admin-conversation-topline">
                    <span className="admin-conversation-date" title={formatDate(conversation.updatedAt)}>
                      {formatRelative(conversation.updatedAt)}
                    </span>
                    <span className="admin-conversation-count">
                      {conversation.messageCount} {conversation.messageCount === 1 ? "message" : "messages"}
                    </span>
                  </span>
                  <strong>{conversation.title}</strong>
                  <span className="admin-conversation-preview">{conversation.latestMessage}</span>
                </button>
              ))
            )}
          </div>
          <p className="admin-list-footnote">Showing up to 100 conversations, newest first.</p>
        </div>

        <div className="admin-detail-panel">
          {selectedId ? (
            <>
              <div className="admin-detail-heading">
                <button
                  className="admin-back"
                  type="button"
                  onClick={() => setSelectedId(null)}
                >
                  <span aria-hidden="true">←</span> Conversations
                </button>
                <div className="admin-detail-meta">
                  <span>Session</span>
                  <code>{selectedId.slice(0, 8)}</code>
                </div>
                <h2>{selectedSummary?.title ?? "Conversation"}</h2>
                <p>
                  Started {selectedSummary ? formatDate(selectedSummary.createdAt) : ""}
                  {selectedSummary ? ` · Updated ${formatRelative(selectedSummary.updatedAt)}` : ""}
                </p>
              </div>
              <div className="admin-transcript" aria-live="polite">
                {loadingTranscript ? (
                  <p className="admin-empty">Loading transcript…</p>
                ) : transcript?.messages.map((message) => (
                  <article className={`admin-message ${message.role}`} key={message.seq}>
                    <div className="admin-message-meta">
                      <span>{message.role === "user" ? "Visitor" : message.role === "assistant" ? "Assistant" : "Summary"}</span>
                      <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    </div>
                    <p>{message.content}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="admin-detail-empty">
              <div className="admin-detail-orbit" aria-hidden="true"><span /></div>
              <p className="admin-eyebrow">Conversation record</p>
              <h2>Select a conversation</h2>
              <p>Choose a row to read the stored exchange. Sessions are anonymous.</p>
            </div>
          )}
        </div>
      </section>

      <footer className="admin-footer">
        <span>{import.meta.env.DEV ? "Local data only" : "Access controlled"}</span>
        <span>Conversation records are anonymous; no recruiter identity is collected.</span>
      </footer>
    </main>
  );
}
