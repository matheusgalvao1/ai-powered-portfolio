import type { ConversationSummary } from "../lib/conversationStore.js";

export function Sidebar({
  open,
  conversations,
  activeId,
  onSelect,
  onDelete,
}: {
  open: boolean;
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside
      className={`sidebar${open ? " open" : ""}`}
      aria-label="Conversation history"
      aria-hidden={!open}
    >
      {open
        ? conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`sidebar-item${
                conversation.id === activeId ? " active" : ""
              }`}
            >
              <button
                type="button"
                className="sidebar-item-title-button"
                onClick={() => onSelect(conversation.id)}
              >
                <span className="sidebar-item-title">{conversation.title}</span>
              </button>
              {conversation.id === activeId ? null : (
                <button
                  type="button"
                  className="sidebar-item-delete"
                  aria-label={`Delete "${conversation.title}"`}
                  onClick={() => onDelete(conversation.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M3 6h18"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          ))
        : null}
    </aside>
  );
}
