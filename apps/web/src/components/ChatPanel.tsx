import { useEffect, useRef } from "react";
import { useChat } from "../hooks/useChat.js";
import { Message } from "./Message.js";
import { Composer } from "./Composer.js";

export function ChatPanel() {
  const { messages, sendMessage, isSending, resetConversation } = useChat();
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }
    if (messages.length === 0) {
      stickToBottomRef.current = true;
      return;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  };

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
      <div className="messages" aria-live="polite" ref={messagesRef} onScroll={handleScroll}>
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </div>
      <Composer disabled={isSending} onSubmit={sendMessage} />
    </section>
  );
}
