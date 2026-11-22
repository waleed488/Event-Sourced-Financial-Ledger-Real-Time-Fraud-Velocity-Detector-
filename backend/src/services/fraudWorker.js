// ============================================================================
// services/fraudWorker.js
// Real-Time Fraud Velocity Detector driven by MongoDB Change Streams.
//
// Features:
// 1. Gated by ENABLE_FRAUD_WORKER env flag (disable during 500k seeding).
// 2. Persists resume tokens in "stream_checkpoints" for crash recovery.
// 3. Recovers cleanly from ChangeStreamHistoryLost (286) / FatalError (280).
// 4. Evaluates all 4 rules with bounded ESR-indexed queries and emits SSE alerts.
// ============================================================================

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { getDb } from "../config/db.js";
import { evaluateImpossibleTravel } from "../utils/geo.js";

const CHECKPOINT_ID = "fraud_worker_v1";
const OUTGOING_TYPES = ["TRANSFER_OUT", "WITHDRAWAL"];

export const alertBus = new EventEmitter();

let changeStream = null;
let isRunning = false;
let shouldKeepRunning = false;

export function getFraudWorkerStatus() {
  return {
    enabled: process.env.ENABLE_FRAUD_WORKER !== "false",
    running: isRunning
  };
}

function getBucketKey(dateValue, bucketMinutes) {
  const ms = new Date(dateValue).getTime();
  const bucketMs = bucketMinutes * 60 * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs).toISOString().slice(0, 16);
}

/**
 * Insert an alert while swallowing duplicate-key errors (dedup_key unique index).
 */
async function saveAlertIfNew(db, alertDoc) {
  try {
    await db.collection("fraud_alerts").insertOne(alertDoc);
    alertBus.emit("alert", alertDoc);
    console.log(
      `[fraud] ALERT ${alertDoc.rule_triggered} (${alertDoc.severity}) on ${alertDoc.account_id} in ${alertDoc.detection_latency_ms}ms`
    );
  } catch (err) {
    if (err.code === 11000) {
      return; // Already alerted for this account, rule, and time window
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Rule 1: Burst Velocity — 6 or more outgoing events within 2 minutes
// ----------------------------------------------------------------------------
async function checkBurstVelocity(db, event) {
  const twoMinsAgo = new Date(event.timestamp.getTime() - 2 * 60 * 1000);

  const recentEvents = await db
    .collection("ledger_events")
    .find(
      {
        account_id: event.account_id,
        type: { $in: OUTGOING_TYPES },
        timestamp: { $gte: twoMinsAgo, $lte: event.timestamp }
      },
      { projection: { _id: 0, amount: 1 } }
    )
    .toArray();

  if (recentEvents.length < 6) {
    return;
  }

  const totalAmount = recentEvents.reduce((sum, item) => sum + item.amount, 0);
  const detectedAt = new Date();

  await saveAlertIfNew(db, {
    alert_id: `ALT-${crypto.randomUUID()}`,
    dedup_key: `${event.account_id}:BURST_VELOCITY:${getBucketKey(event.timestamp, 2)}`,
    account_id: event.account_id,
    trigger_event_id: event.event_id,
    rule_triggered: "BURST_VELOCITY",
    window_tx_count: recentEvents.length,
    window_total_amount: totalAmount,
    details: { threshold_count: 6, window_minutes: 2 },
    severity: "HIGH",
    event_created_at: event.timestamp,
    detected_at: detectedAt,
    detection_latency_ms: Math.max(0, detectedAt - event.timestamp),
    status: "open"
  });
}

// ----------------------------------------------------------------------------
// Rule 2: Spending Spike — transfer or 15m sum > 3x prior rolling average
// ----------------------------------------------------------------------------
async function checkSpendingSpike(db, event) {
  const fifteenMinsAgo = new Date(event.timestamp.getTime() - 15 * 60 * 1000);

  // Fetch up to 20 prior outgoing transactions to establish baseline
  const priorEvents = await db
    .collection("ledger_events")
    .find(
      {
        account_id: event.account_id,
        type: { $in: OUTGOING_TYPES },
        timestamp: { $lt: event.timestamp }
      },
      { projection: { _id: 0, amount: 1 } }
    )
    .sort({ timestamp: -1 })
    .limit(20)
    .toArray();

  // Cold-start guard: require at least 5 prior outgoing events
  if (priorEvents.length < 5) {
    return;
  }

  const rollingAvg =
    priorEvents.reduce((sum, item) => sum + item.amount, 0) / priorEvents.length;

  if (rollingAvg < 1000) {
    return; // Ignore tiny baseline accounts
  }

  const recent15m = await db
    .collection("ledger_events")
    .find(
      {
        account_id: event.account_id,
        type: { $in: OUTGOING_TYPES },
        timestamp: { $gte: fifteenMinsAgo, $lte: event.timestamp }
      },
      { projection: { _id: 0, amount: 1 } }
    )
    .toArray();

  const sum15m = recent15m.reduce((sum, item) => sum + item.amount, 0);

  if (event.amount <= 3 * rollingAvg && sum15m <= 3 * rollingAvg) {
    return;
  }

  const detectedAt = new Date();
  await saveAlertIfNew(db, {
    alert_id: `ALT-${crypto.randomUUID()}`,
    dedup_key: `${event.account_id}:SPENDING_SPIKE:${getBucketKey(event.timestamp, 15)}`,
    account_id: event.account_id,
    trigger_event_id: event.event_id,
    rule_triggered: "SPENDING_SPIKE",
    window_tx_count: recent15m.length,
    window_total_amount: sum15m,
    details: {
      rolling_avg: Math.round(rollingAvg),
      event_amount: event.amount,
      multiplier: Number((Math.max(event.amount, sum15m) / rollingAvg).toFixed(2))
    },
    severity: "MEDIUM",
    event_created_at: event.timestamp,
    detected_at: detectedAt,
    detection_latency_ms: Math.max(0, detectedAt - event.timestamp),
    status: "open"
  });
}

// ----------------------------------------------------------------------------
// Rule 3: Daily Limit Breach — 24h outgoing total exceeds account.daily_limit
// ----------------------------------------------------------------------------
async function checkDailyLimitBreach(db, event) {
  const account = await db
    .collection("accounts")
    .findOne({ account_id: event.account_id }, { projection: { daily_limit: 1 } });

  if (!account || typeof account.daily_limit !== "number") {
    return;
  }

  const oneDayAgo = new Date(event.timestamp.getTime() - 24 * 60 * 60 * 1000);

  const summary = await db
    .collection("ledger_events")
    .aggregate([
      {
        $match: {
          account_id: event.account_id,
          type: { $in: OUTGOING_TYPES },
          timestamp: { $gte: oneDayAgo, $lte: event.timestamp }
        }
      },
      {
        $group: {
          _id: null,
          total_amount: { $sum: "$amount" },
          tx_count: { $sum: 1 }
        }
      }
    ])
    .toArray();

  if (summary.length === 0 || summary[0].total_amount <= account.daily_limit) {
    return;
  }

  const detectedAt = new Date();
  const utcDay = event.timestamp.toISOString().slice(0, 10);

  await saveAlertIfNew(db, {
    alert_id: `ALT-${crypto.randomUUID()}`,
    dedup_key: `${event.account_id}:DAILY_LIMIT_BREACH:${utcDay}`,
    account_id: event.account_id,
    trigger_event_id: event.event_id,
    rule_triggered: "DAILY_LIMIT_BREACH",
    window_tx_count: summary[0].tx_count,
    window_total_amount: summary[0].total_amount,
    details: { daily_limit: account.daily_limit },
    severity: "MEDIUM",
    event_created_at: event.timestamp,
    detected_at: detectedAt,
    detection_latency_ms: Math.max(0, detectedAt - event.timestamp),
    status: "open"
  });
}

// ----------------------------------------------------------------------------
// Rule 4: Impossible Travel — > 100 km & > 900 km/h (with zero-time guard)
// ----------------------------------------------------------------------------
async function checkImpossibleTravel(db, event) {
  if (!event.geo_location) {
    return;
  }

  const previous = await db
    .collection("ledger_events")
    .find(
      {
        account_id: event.account_id,
        event_id: { $ne: event.event_id },
        timestamp: { $lte: event.timestamp },
        geo_location: { $exists: true }
      },
      { projection: { geo_location: 1, timestamp: 1 } }
    )
    .sort({ timestamp: -1, _id: -1 })
    .limit(1)
    .toArray();

  if (previous.length === 0) {
    return;
  }

  const prev = previous[0];
  const travel = evaluateImpossibleTravel(
    prev.geo_location,
    prev.timestamp,
    event.geo_location,
    event.timestamp
  );

  if (!travel.isImpossible) {
    return;
  }

  const detectedAt = new Date();
  await saveAlertIfNew(db, {
    alert_id: `ALT-${crypto.randomUUID()}`,
    dedup_key: `${event.account_id}:IMPOSSIBLE_TRAVEL:${event.event_id}`,
    account_id: event.account_id,
    trigger_event_id: event.event_id,
    rule_triggered: "IMPOSSIBLE_TRAVEL",
    window_tx_count: 2,
    window_total_amount: event.amount,
    details: {
      prev_city: prev.geo_location.city || "Unknown",
      curr_city: event.geo_location.city || "Unknown",
      distance_km: travel.distanceKm,
      delta_seconds: travel.deltaSeconds,
      speed_kmh: travel.speedKmh
    },
    severity: "HIGH",
    event_created_at: event.timestamp,
    detected_at: detectedAt,
    detection_latency_ms: Math.max(0, detectedAt - event.timestamp),
    status: "open"
  });
}

async function processChangeEvent(db, change) {
  const event = change.fullDocument;
  if (!event) return;

  // Evaluate all 4 fraud rules concurrently for this outgoing event
  await Promise.all([
    checkBurstVelocity(db, event),
    checkSpendingSpike(db, event),
    checkDailyLimitBreach(db, event),
    checkImpossibleTravel(db, event)
  ]);

  // Save resume token only after rule checks complete
  await db.collection("stream_checkpoints").updateOne(
    { _id: CHECKPOINT_ID },
    { $set: { resume_token: change._id, updated_at: new Date() } },
    { upsert: true }
  );
}

async function openStream(db) {
  const checkpoint = await db.collection("stream_checkpoints").findOne({ _id: CHECKPOINT_ID });
  const pipeline = [
    {
      $match: {
        operationType: "insert",
        "fullDocument.type": { $in: OUTGOING_TYPES }
      }
    }
  ];

  const options = {};
  if (checkpoint && checkpoint.resume_token) {
    options.resumeAfter = checkpoint.resume_token;
    console.log("[fraud] Resuming Change Stream from saved checkpoint.");
  } else {
    console.log("[fraud] Opening fresh Change Stream on ledger_events.");
  }

  try {
    changeStream = db.collection("ledger_events").watch(pipeline, options);
  } catch (err) {
    if (err.code === 286 || err.code === 280) {
      console.warn(`[fraud] Stale resume token (code ${err.code}). Clearing checkpoint and retrying.`);
      await db.collection("stream_checkpoints").deleteOne({ _id: CHECKPOINT_ID });
      changeStream = db.collection("ledger_events").watch(pipeline, {});
    } else {
      throw err;
    }
  }

  isRunning = true;

  changeStream.on("change", async (change) => {
    try {
      await processChangeEvent(db, change);
    } catch (err) {
      console.error("[fraud] Error processing change event:", err.message);
    }
  });

  changeStream.on("error", async (err) => {
    isRunning = false;
    console.error("[fraud] Change Stream error:", err.code, err.message);

    // Handle ChangeStreamHistoryLost (286) or ChangeStreamFatalError (280)
    if (err.code === 286 || err.code === 280) {
      console.warn("[fraud] Deleting stale resume token after fatal stream error...");
      await db.collection("stream_checkpoints").deleteOne({ _id: CHECKPOINT_ID });
    }

    if (shouldKeepRunning) {
      setTimeout(() => {
        if (shouldKeepRunning) {
          openStream(db).catch((e) => console.error("[fraud] Reopen failed:", e.message));
        }
      }, 1500);
    }
  });
}

export async function startFraudWorker() {
  if (process.env.ENABLE_FRAUD_WORKER === "false") {
    console.log("[fraud] ENABLE_FRAUD_WORKER=false -> Change Stream listener skipped.");
    return;
  }

  const db = getDb();
  shouldKeepRunning = true;
  await openStream(db);
}

export async function stopFraudWorker() {
  shouldKeepRunning = false;
  isRunning = false;
  if (changeStream) {
    await changeStream.close();
    changeStream = null;
  }
}
