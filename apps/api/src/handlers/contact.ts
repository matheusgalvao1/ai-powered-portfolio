import type { Request, Response } from "express";

// Public contact links for the web client's sidebar, straight from
// packages/config (CONTACT_* env vars). Open on purpose: the underlying data
// is public contact information, and the endpoint returns static JSON without
// touching the model. Unset values are omitted; a 404 means nothing is
// configured — the client hides the links.
export function createContactHandler({
  contact,
}: {
  contact: { email: string; linkedin: string; github: string };
}) {
  return async function contactHandler(_req: Request, res: Response): Promise<void> {
    const entries = Object.fromEntries(
      Object.entries(contact).filter(([, value]) => value.trim().length > 0),
    );

    if (Object.keys(entries).length === 0) {
      res.status(404).json({ error: "No contact information is configured." });
      return;
    }

    res.json(entries);
  };
}
