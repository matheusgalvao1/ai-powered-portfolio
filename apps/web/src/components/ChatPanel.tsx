import { useEffect, useRef } from "react";
import { useChat } from "../hooks/useChat.js";
import { Message } from "./Message.js";
import { Composer } from "./Composer.js";

export function ChatPanel() {
  const { messages, sendMessage, isSending } = useChat();
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <section className="panel" aria-label="Chat">
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
