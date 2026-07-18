import { useEffect, useRef } from "react";
import { useChat } from "../hooks/useChat.js";
import { Message } from "./Message.js";
import { Composer } from "./Composer.js";

export function ChatPanel() {
  const { messages, sendMessage, isSending, resetConversation } = useChat();
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <section className="panel" aria-label="Chat">
      <div className="panel-header">
        <span className="panel-header-label">Chat</span>
        <button
          type="button"
          className="reset-button"
          onClick={resetConversation}
          disabled={messages.length === 0}
        >
          New chat
        </button>
      </div>
      <div className="messages" aria-live="polite" ref={messagesRef}>
        {messages.length === 0 ? (
          <p className="empty-state">
            Try &ldquo;What are his strongest backend skills?&rdquo; or &ldquo;Tell
            me about a technically difficult project.&rdquo;
          </p>
        ) : (
          messages.map((message) => <Message key={message.id} message={message} />)
        )}
      </div>
      <Composer disabled={isSending} onSubmit={sendMessage} />
    </section>
  );
}
