import { useLayoutEffect, useRef, useState } from "react";
import type { TouchEvent, WheelEvent } from "react";
import type { ChatAttachment } from "@portfolio/shared";
import { useChat } from "../hooks/useChat.js";
import { Message } from "./Message.js";
import { Composer } from "./Composer.js";
import { Sidebar } from "./Sidebar.js";

// Within this distance of the bottom the user counts as "following" the
// stream; an exact 0 is unreliable because content grows between scroll
// events and momentum scrolling overshoots.
const STICK_THRESHOLD_PX = 24;

export function ChatPanel() {
  const {
    messages,
    sendMessage,
    isSending,
    stop,
    resetConversation,
    conversations,
    activeConversationId,
    switchConversation,
  } = useChat();
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // The scrollTop the panel last assigned itself; a scroll event still at
  // that position is the auto-scroll, never the user.
  const expectedScrollTopRef = useRef<number | null>(null);
  const lastTouchYRef = useRef<number | null>(null);
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

  const scrollToBottom = () => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    if (el.scrollTop < maxScrollTop) {
      expectedScrollTopRef.current = maxScrollTop;
      el.scrollTop = maxScrollTop;
    }
  };

  // useLayoutEffect: scroll before the browser paints, so fast token updates
  // never show content below the fold for a frame.
  useLayoutEffect(() => {
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
      scrollToBottom();
    }
    updateFadeEdges();
  }, [messages]);

  // Input-level intent, checked ahead of any scroll event the browser may
  // coalesce: one upward wheel notch or downward touch drag stops following.
  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) {
      stickToBottomRef.current = false;
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    lastTouchYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: TouchEvent) => {
    const currentY = event.touches[0]?.clientY ?? null;
    const previousY = lastTouchYRef.current;
    lastTouchYRef.current = currentY;
    if (previousY !== null && currentY !== null && currentY > previousY) {
      stickToBottomRef.current = false;
    }
  };

  const handleScroll = () => {
    const el = messagesRef.current;
    if (!el) {
      return;
    }

    const expected = expectedScrollTopRef.current;
    const isAutoScroll = expected !== null && Math.abs(el.scrollTop - expected) < 1;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (!isAutoScroll) {
      stickToBottomRef.current = distanceFromBottom <= STICK_THRESHOLD_PX;
    }
    updateFadeEdges();
  };

  // Sending a message always re-engages following the stream, even if the
  // user had scrolled up while reading the previous response; new chat does
  // the same for the fresh welcome message.
  const handleSubmitMessage = (text: string, attachments: ChatAttachment[]) => {
    stickToBottomRef.current = true;
    void sendMessage(text, attachments);
  };

  const handleNewChat = () => {
    stickToBottomRef.current = true;
    resetConversation();
  };

  const handleSelectConversation = (id: string) => {
    stickToBottomRef.current = true;
    switchConversation(id);
  };

  // Collapsed by default: each visit starts with the history rail closed.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // The orb parks beside the most recent real assistant message; interrupt
  // and error tombstones never host it.
  let orbIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") {
      orbIndex = i;
      break;
    }
  }

  return (
    <>
      <button
        type="button"
        className={`sidebar-toggle${sidebarOpen ? " open" : ""}`}
        aria-label="Toggle conversations"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 3 5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 3l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
      />
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
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
        >
          {messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              hasOrb={index === orbIndex}
            />
          ))}
        </div>
      </div>
      <Composer
        disabled={isSending}
        canReset={messages.length > 1}
        onSubmit={handleSubmitMessage}
        onNewChat={handleNewChat}
        onStop={stop}
      />
    </section>
    </>
  );
}
