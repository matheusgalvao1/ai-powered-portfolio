import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export function Composer({
  disabled,
  canReset,
  onSubmit,
  onNewChat,
}: {
  disabled: boolean;
  canReset: boolean;
  onSubmit: (message: string) => void;
  onNewChat: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = inputRef.current?.value ?? "";
    onSubmit(value);
    if (inputRef.current) {
      inputRef.current.value = "";
      setHasText(false);
    }
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <button
        className="composer-new-chat"
        type="button"
        aria-label="New chat"
        title="New chat"
        onClick={onNewChat}
        disabled={disabled || !canReset}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M18.375 2.625a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        ref={inputRef}
        className="composer-input"
        type="text"
        placeholder="Ask about Matheus..."
        autoComplete="off"
        autoFocus
        disabled={disabled}
        onInput={(event) =>
          setHasText(event.currentTarget.value.trim().length > 0)
        }
      />
      <button
        className="composer-send"
        type="submit"
        aria-label="Send"
        disabled={disabled || !hasText}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 13V3M8 3L3.5 7.5M8 3L12.5 7.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </form>
  );
}
