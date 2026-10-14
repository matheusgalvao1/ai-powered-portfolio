import { Router } from "express";
import type { RequestHandler } from "express";
import { UUID_PATTERN } from "@portfolio/shared";
import type { SessionStore } from "../sessionStore.js";

const RANGES = ["7d", "30d", "all"] as const;
type DashboardRange = (typeof RANGES)[number];

export function createAdminRouter({
  store,
  enabled,
  authorize,
}: {
  store: SessionStore;
  enabled: boolean;
  authorize?: RequestHandler;
}) {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    if (!enabled) {
      res.sendStatus(404);
      return;
    }
    next();
  });

  if (authorize) {
    router.use(authorize);
  }

  router.get("/overview", async (req, res, next) => {
    const requestedRange = req.query.range;
    if (
      requestedRange !== undefined &&
      (typeof requestedRange !== "string" ||
        !RANGES.includes(requestedRange as DashboardRange))
    ) {
      res.status(400).json({ error: "range must be 7d, 30d, or all" });
      return;
    }

    const range = (requestedRange as DashboardRange | undefined) ?? "7d";
    try {
      res.json(await store.dashboardOverview(range));
    } catch (error) {
      next(error);
    }
  });

  router.get("/conversations/:sessionId", async (req, res, next) => {
    const { sessionId } = req.params;
    if (!UUID_PATTERN.test(sessionId)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }

    try {
      const conversation = await store.loadConversation(sessionId);
      if (!conversation) {
        res.sendStatus(404);
        return;
      }
      res.json(conversation);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
