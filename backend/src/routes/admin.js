// ============================================================================
// routes/admin.js
// Administrative endpoints: CQRS balance rebuild/verify, $setWindowFields
// fraud backfill, and system health status.
// ============================================================================

import { Router } from "express";
import { getDb } from "../config/db.js";
import { runWindowAnalyticsBackfill } from "../services/analyticsService.js";
import { getFraudWorkerStatus } from "../services/fraudWorker.js";
import { rebuildBalances, verifyBalances } from "../services/recoveryService.js";

const router = Router();

// Rebuild account_balances from ledger_events ($group + $merge)
router.post("/rebuild-balances", async (req, res, next) => {
  try {
    const result = await rebuildBalances();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Verify live read model matches ledger_events exactly
router.post("/verify-balances", async (req, res, next) => {
  try {
    const result = await verifyBalances();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Run $setWindowFields fraud backfill
router.post("/backfill-fraud", async (req, res, next) => {
  try {
    const accountId = req.body?.accountId || null;
    const result = await runWindowAnalyticsBackfill({ accountId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Cluster & collection counts summary for dashboard header
router.get("/status", async (req, res, next) => {
  try {
    const db = getDb();
    const [accountsCount, eventsCount, openAlertsCount, rsStatus] = await Promise.all([
      db.collection("accounts").countDocuments(),
      db.collection("ledger_events").estimatedDocumentCount(),
      db.collection("fraud_alerts").countDocuments({ status: "open" }),
      db.admin().command({ replSetGetStatus: 1 }).catch(() => null)
    ]);

    const members = rsStatus
      ? rsStatus.members.map((m) => ({ name: m.name, stateStr: m.stateStr, health: m.health }))
      : [];

    res.json({
      collections: {
        accounts: accountsCount,
        ledger_events: eventsCount,
        open_fraud_alerts: openAlertsCount
      },
      fraud_worker: getFraudWorkerStatus(),
      replica_set: members
    });
  } catch (err) {
    next(err);
  }
});

export default router;
