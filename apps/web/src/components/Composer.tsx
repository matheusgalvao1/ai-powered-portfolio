import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { ChatAttachment } from "@portfolio/shared";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
} from "@portfolio/shared";

type PendingAttachment = ChatAttachment & { dataUrl: string };

// Browsers disagree on MIME types for less common extensions (.md, .csv), so
// empty file.type falls back to an extension lookup.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function resolveMimeType(file: File): string | null {
  if (file.type) {
    return file.type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_TYPES[extension] ?? null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function Composer({
  disabled,
  onSubmit,
  onStop,
}: {
  disabled: boolean;
  onSubmit: (message: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const maxMegabytes = Math.ceil(MAX_ATTACHMENT_BYTES / (1024 * 1024));

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const candidates = Array.from(files);
    const accepted: Array<{ file: File; mimeType: string }> = [];
    let error: string | null = null;

    for (const file of candidates) {
      const mimeType = resolveMimeType(file);
      if (!mimeType || !isAllowedAttachmentType(mimeType)) {
        error = `Unsupported file type: ${file.name}`;
      } else if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `${file.name} is too large (max ${maxMegabytes} MB).`;
      } else if (pending.length + accepted.length >= MAX_ATTACHMENT_FILES) {
        error = `You can attach up to ${MAX_ATTACHMENT_FILES} files per message.`;
        break;
      } else {
        accepted.push({ file, mimeType });
      }
    }

    setAttachmentError(error);

    if (accepted.length === 0) {
      return;
    }

    try {
      const next = await Promise.all(
        accepted.map(async ({ file, mimeType }) => {
          const dataUrl = await readAsDataUrl(file);
          return {
            id: crypto.randomUUID(),
            name: file.name,
            mimeType,
            data: dataUrl.slice(dataUrl.indexOf(",") + 1),
            dataUrl,
          };
        }),
      );
      setPending((prev) => [...prev, ...next]);
    } catch {
      setAttachmentError("Could not read the selected file(s).");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = inputRef.current?.value ?? "";
    const attachments: ChatAttachment[] = pending.map(
      ({ id, name, mimeType, data }) => ({ id, name, mimeType, data }),
    );
    onSubmit(value, attachments);
    if (inputRef.current) {
      inputRef.current.value = "";
      setHasText(false);
    }
    setPending([]);
    setAttachmentError(null);
  };

  const accept = [...ALLOWED_ATTACHMENT_MIME_TYPES, ".txt", ".md", ".csv"].join(",");

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {attachmentError ? (
        <div className="composer-error" role="alert">
          {attachmentError}
        </div>
      ) : null}
      {pending.length > 0 ? (
        <div className="composer-attachments">
          {pending.map((attachment) => (
            <span key={attachment.id} className="composer-attachment">
              {attachment.mimeType.startsWith("image/") ? (
                <img
                  className="composer-attachment-image"
                  src={attachment.dataUrl}
                  alt={attachment.name}
                />
              ) : (
                <span className="composer-attachment-chip">{attachment.name}</span>
              )}
              <button
                type="button"
                className="composer-attachment-remove"
                aria-label={`Remove ${attachment.name}`}
                onClick={() =>
                  setPending((prev) => prev.filter((item) => item.id !== attachment.id))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="composer-row">
        <button
          className="composer-attach"
          type="button"
          aria-label="Attach files"
          title="Attach files"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          className="composer-file-input"
          type="file"
          multiple
          accept={accept}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={inputRef}
          className="composer-input"
          type="text"
          placeholder="Ask about Matheus..."
          autoComplete="off"
          autoFocus
          disabled={disabled}
          onInput={(event) => setHasText(event.currentTarget.value.trim().length > 0)}
        />
        {disabled ? (
          <button
            className="composer-send"
            type="button"
            aria-label="Stop"
            title="Stop"
            onClick={onStop}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            className="composer-send"
            type="submit"
            aria-label="Send"
            disabled={!hasText}
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
        )}
      </div>
    </form>
  );
}
