import { useEffect, useRef, useState } from "react";
import { useChat } from "../hooks/useChat.js";
import { Message } from "./Message.js";
import { Composer } from "./Composer.js";

export function ChatPanel() {
  const { messages, sendMessage, isSending } = useChat();
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [fadeEdges, setFadeEdges] = useState({ top: false, bottom: false });

  const updateFadeEdges = () => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }

    const threshold = 8;
    const canScroll = el.scrollHeight - el.clientHeight > threshold;
    const nextEdges = {
      top: canScroll && el.scrollTop > threshold,
      bottom:
        canScroll && el.scrollTop + el.clientHeight < el.scrollHeight - threshold,
    };

    setFadeEdges((current) =>
      current.top === nextEdges.top && current.bottom === nextEdges.bottom
        ? current
        : nextEdges,
    );
  };

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }
    if (messages.length === 0) {
      stickToBottomRef.current = true;
      updateFadeEdges();
      return;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    updateFadeEdges();
  }, [messages]);

  const handleScroll = () => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= 4;
    updateFadeEdges();
  };

  return (
    <section className="chat" aria-label="Chat">
      <div
        className={`messages-viewport${fadeEdges.top ? " has-top-fade" : ""}${
          fadeEdges.bottom ? " has-bottom-fade" : ""
        }`}
      >
        <div
          className="messages"
          aria-live="polite"
          ref={messagesRef}
          onScroll={handleScroll}
        >
          {messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
            />
          ))}
        </div>
      </div>
      <Composer disabled={isSending} onSubmit={sendMessage} />
    </section>
  );
}
