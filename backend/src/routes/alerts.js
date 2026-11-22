// ============================================================================
// routes/alerts.js
// REST endpoints + Server-Sent Events (SSE) stream for live fraud alerts.
// ============================================================================

import { Router } from "express";
import { getDb } from "../config/db.js";
import { alertBus } from "../services/fraudWorker.js";
import { AppError } from "../utils/errors.js";

const router = Router();

// List fraud alerts (uses partial ESR indexes when status="open")
router.get("/", async (req, res, next) => {
  try {
    const db = getDb();
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.accountId) filter.account_id = req.query.accountId;

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const alerts = await db
      .collection("fraud_alerts")
      .find(filter)
      .sort({ detected_at: -1 })
      .limit(limit)
      .toArray();

    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// Mark an open fraud alert as resolved
router.patch("/:alertId/resolve", async (req, res, next) => {
  try {
    const db = getDb();
    const updated = await db.collection("fraud_alerts").findOneAndUpdate(
      { alert_id: req.params.alertId },
      { $set: { status: "resolved" } },
      { returnDocument: "after" }
    );
    if (!updated) {
      throw new AppError(404, "ALERT_NOT_FOUND", `Alert "${req.params.alertId}" not found.`);
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Server-Sent Events (SSE) endpoint for pushing real-time fraud alerts to React
router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send an initial ping so the browser knows the stream is connected
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const onAlert = (alertDoc) => {
    res.write(`event: alert\ndata: ${JSON.stringify(alertDoc)}\n\n`);
  };

  alertBus.on("alert", onAlert);

  // Keep-alive heartbeat every 20s
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    alertBus.off("alert", onAlert);
  });
});

export default router;
