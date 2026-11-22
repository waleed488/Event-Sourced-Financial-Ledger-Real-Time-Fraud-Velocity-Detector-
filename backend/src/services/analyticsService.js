// ============================================================================
// services/analyticsService.js
// Analytical Fraud Path using MongoDB $setWindowFields.
// Used for historical backfill over the 500,000 seeded events and for
// cross-checking the real-time Change Stream fraud detector.
// ============================================================================

import crypto from "node:crypto";
import { getDb } from "../config/db.js";

/**
 * Format a Date into a fixed-minute bucket string for alert deduplication.
 */
function getBucketKey(dateValue, bucketMinutes) {
  const ms = new Date(dateValue).getTime();
  const bucketMs = bucketMinutes * 60 * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs).toISOString().slice(0, 16);
}

/**
 * Run $setWindowFields over historical outgoing events to backfill
 * BURST_VELOCITY and SPENDING_SPIKE alerts.
 */
export async function runWindowAnalyticsBackfill({ accountId = null } = {}) {
  const db = getDb();
  const startedAt = Date.now();

  // Step 1: Selective $match FIRST so windowing processes only outgoing transfers/withdrawals
  const initialMatch = { type: { $in: ["TRANSFER_OUT", "WITHDRAWAL"] } };
  if (accountId) {
    initialMatch.account_id = accountId;
  }

  const pipeline = [
    { $match: initialMatch },
    // Step 2: Partition by account_id and compute rolling 2m, 15m, and prior-20 stats
    {
      $setWindowFields: {
        partitionBy: "$account_id",
        sortBy: { timestamp: 1 },
        output: {
          tx_count_2m: {
            $count: {},
            window: { range: [-2, 0], unit: "minute" }
          },
          sum_2m: {
            $sum: "$amount",
            window: { range: [-2, 0], unit: "minute" }
          },
          sum_15m: {
            $sum: "$amount",
            window: { range: [-15, 0], unit: "minute" }
          },
          prior_count_20: {
            $count: {},
            window: { documents: [-20, -1] }
          },
          avg_prev_20: {
            $avg: "$amount",
            window: { documents: [-20, -1] }
          }
        }
      }
    },
    // Step 3: Keep only rows that breach Burst Velocity or Spending Spike rules
    {
      $match: {
        $or: [
          { tx_count_2m: { $gte: 6 } },
          {
            $and: [
              { prior_count_20: { $gte: 5 } },
              { avg_prev_20: { $gte: 1000 } },
              {
                $or: [
                  { $expr: { $gt: ["$amount", { $multiply: ["$avg_prev_20", 3] }] } },
                  { $expr: { $gt: ["$sum_15m", { $multiply: ["$avg_prev_20", 3] }] } }
                ]
              }
            ]
          }
        ]
      }
    }
  ];

  // allowDiskUse: true is essential for 500,000 events
  const flaggedEvents = await db
    .collection("ledger_events")
    .aggregate(pipeline, { allowDiskUse: true })
    .toArray();

  const bulkOps = [];
  const now = new Date();

  for (const ev of flaggedEvents) {
    if (ev.tx_count_2m >= 6) {
      const bucket = getBucketKey(ev.timestamp, 2);
      const dedupKey = `${ev.account_id}:BURST_VELOCITY:${bucket}`;
      bulkOps.push({
        updateOne: {
          filter: { dedup_key: dedupKey },
          update: {
            $setOnInsert: {
              alert_id: `ALT-${crypto.randomUUID()}`,
              dedup_key: dedupKey,
              account_id: ev.account_id,
              trigger_event_id: ev.event_id,
              rule_triggered: "BURST_VELOCITY",
              window_tx_count: ev.tx_count_2m,
              window_total_amount: ev.sum_2m,
              details: { source: "window_backfill" },
              severity: "HIGH",
              event_created_at: ev.timestamp,
              detected_at: now,
              detection_latency_ms: 0,
              status: "open"
            }
          },
          upsert: true
        }
      });
    }

    if (
      ev.prior_count_20 >= 5 &&
      ev.avg_prev_20 >= 1000 &&
      (ev.amount > 3 * ev.avg_prev_20 || ev.sum_15m > 3 * ev.avg_prev_20)
    ) {
      const bucket = getBucketKey(ev.timestamp, 15);
      const dedupKey = `${ev.account_id}:SPENDING_SPIKE:${bucket}`;
      bulkOps.push({
        updateOne: {
          filter: { dedup_key: dedupKey },
          update: {
            $setOnInsert: {
              alert_id: `ALT-${crypto.randomUUID()}`,
              dedup_key: dedupKey,
              account_id: ev.account_id,
              trigger_event_id: ev.event_id,
              rule_triggered: "SPENDING_SPIKE",
              window_tx_count: ev.prior_count_20,
              window_total_amount: ev.sum_15m,
              details: {
                source: "window_backfill",
                rolling_avg: Math.round(ev.avg_prev_20),
                event_amount: ev.amount
              },
              severity: "MEDIUM",
              event_created_at: ev.timestamp,
              detected_at: now,
              detection_latency_ms: 0,
              status: "open"
            }
          },
          upsert: true
        }
      });
    }
  }

  let insertedCount = 0;
  if (bulkOps.length > 0) {
    // Process in chunks of 1,000 bulk operations
    for (let i = 0; i < bulkOps.length; i += 1000) {
      const chunk = bulkOps.slice(i, i + 1000);
      const res = await db.collection("fraud_alerts").bulkWrite(chunk, { ordered: false });
      insertedCount += res.upsertedCount || 0;
    }
  }

  return {
    flagged_events_scanned: flaggedEvents.length,
    new_alerts_inserted: insertedCount,
    duration_ms: Date.now() - startedAt
  };
}
