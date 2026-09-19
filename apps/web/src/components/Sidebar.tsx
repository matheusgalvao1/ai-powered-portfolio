import type { ConversationSummary } from "../lib/conversationStore.js";

export function Sidebar({
  open,
  conversations,
  activeId,
  onSelect,
}: {
  open: boolean;
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside
      className={`sidebar${open ? " open" : ""}`}
      aria-label="Conversation history"
      aria-hidden={!open}
    >
      {open
        ? conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`sidebar-item${
                conversation.id === activeId ? " active" : ""
              }`}
              onClick={() => onSelect(conversation.id)}
            >
              <span className="sidebar-item-title">{conversation.title}</span>
            </button>
          ))
        : null}
    </aside>
  );
}
