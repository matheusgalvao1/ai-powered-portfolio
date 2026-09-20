import { z } from "zod";
import type { RegisteredTool } from "./types.js";

// The contact links come from packages/config (CONTACT_* env vars), not from
// the portfolio data file — they are deploy-level config, not knowledge-base
// content.
export function createGetContactInformationTool(contact: {
  email: string;
  linkedin: string;
  github: string;
}): RegisteredTool {
  return {
    name: "get_contact_information",
    description: "Return the owner's public contact information (email, LinkedIn, GitHub).",
    inputSchema: z.object({}),
    execute: () => {
      const configured = Object.values(contact).some(
        (value) => value.trim().length > 0,
      );
      if (!configured) {
        return { ok: false, error: "No contact information is currently configured." };
      }
      return contact;
    },
  };
}
