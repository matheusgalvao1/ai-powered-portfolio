import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { API_BASE_URL } from "../lib/apiConfig.js";

type ContactLinks = {
  email: string;
  linkedin: string;
  github: string;
};

type SocialEntry = { key: string; label: string; href: string; icon: ReactNode };

// Structural fail-safe: only full-scheme links render. A stale or malformed
// sync result degrades to fewer (or zero) buttons, never a broken href.
function toEntries(data: Partial<ContactLinks>): SocialEntry[] {
  const entries: SocialEntry[] = [];

  if (typeof data.linkedin === "string" && data.linkedin.startsWith("https://")) {
    entries.push({
      key: "linkedin",
      label: "LinkedIn",
      href: data.linkedin,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
        </svg>
      ),
    });
  }

  if (typeof data.github === "string" && data.github.startsWith("https://")) {
    entries.push({
      key: "github",
      label: "GitHub",
      href: data.github,
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
      ),
    });
  }

  if (typeof data.email === "string" && data.email.startsWith("mailto:")) {
    entries.push({
      key: "email",
      label: "Email",
      href: data.email,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="2"
            y="4"
            width="20"
            height="16"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="m22 7-10 5L2 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    });
  }

  return entries;
}

// `inline` renders the links in-flow (used inside the drawer on compact
// screens); the default is the fixed bottom-left cluster for the desktop
// margin rail.
export function SocialLinks({
  open,
  inline = false,
}: {
  open: boolean;
  inline?: boolean;
}) {
  const [entries, setEntries] = useState<SocialEntry[]>([]);
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/contact`);
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as Partial<ContactLinks>;
        if (!cancelled) {
          setEntries(toEntries(data));
        }
      } catch {
        // The rail simply stays without links when the API is unreachable.
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={`sidebar-social${inline ? " inline" : ""}${open ? " open" : ""}`}>
      {entries.map((entry) => (
        <a
          key={entry.key}
          className="social-link"
          href={entry.href}
          {...(entry.href.startsWith("https://")
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          aria-label={entry.label}
        >
          {entry.icon}
          {open ? <span className="social-link-label">{entry.label}</span> : null}
        </a>
      ))}
    </div>
  );
}
