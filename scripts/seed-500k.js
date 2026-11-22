// ============================================================================
// scripts/seed-500k.js
// Generates 2,000 accounts and 500,000 realistic ledger events over 30 days,
// including 25 deliberate fraud burst/spike patterns, then rebuilds balances.
//
// IMPORTANT: Keep the API / fraudWorker stopped (or ENABLE_FRAUD_WORKER=false)
// while running this script so you do not trigger a 250k-event Change Stream storm.
// ============================================================================

import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

const ACCOUNT_COUNT = 2000;
const TOTAL_EVENTS = 500000;
const BATCH_SIZE = 5000;

const CITIES = [
  { city: "Abbottabad", country: "PK", lat: 34.1688, lon: 73.2215 },
  { city: "Islamabad", country: "PK", lat: 33.6844, lon: 73.0479 },
  { city: "Lahore", country: "PK", lat: 31.5204, lon: 74.3587 },
  { city: "Karachi", country: "PK", lat: 24.8607, lon: 67.0011 }
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const startedAt = Date.now();

  try {
    console.log("[seed-500k] Clearing previous seed/test data...");
    await Promise.all([
      db.collection("accounts").deleteMany({}),
      db.collection("ledger_events").deleteMany({}),
      db.collection("account_balances").deleteMany({}),
      db.collection("fraud_alerts").deleteMany({}),
      db.collection("stream_checkpoints").deleteMany({})
    ]);

    // ------------------------------------------------------------------------
    // Step 1: Insert 2,000 Accounts
    // ------------------------------------------------------------------------
    const now = Date.now();
    const accounts = [];
    for (let i = 1; i <= ACCOUNT_COUNT; i++) {
      const accountId = `ACC-${String(i).padStart(4, "0")}`;
      accounts.push({
        account_id: accountId,
        holder_name: `Customer ${i}`,
        status: "active",
        currency: "USD",
        daily_limit: 500000, // $5,000.00
        risk_profile: {
          tier: i % 10 === 0 ? "high" : "standard",
          home_country: "PK"
        },
        created_at: new Date(now - 35 * 24 * 60 * 60 * 1000)
      });
    }
    await db.collection("accounts").insertMany(accounts, { ordered: false });
    console.log(`[seed-500k] Inserted ${accounts.length} accounts.`);

    // ------------------------------------------------------------------------
    // Step 2: Generate 500,000 Ledger Events in 5,000-doc batches
    // First 2,000 events give every account a large opening DEPOSIT so
    // subsequent withdrawals/transfers stay positive.
    // ------------------------------------------------------------------------
    let inserted = 0;
    let batch = [];

    async function flushBatch() {
      if (batch.length === 0) return;
      await db.collection("ledger_events").insertMany(batch, { ordered: false });
      inserted += batch.length;
      batch = [];
      if (inserted % 50000 === 0 || inserted === TOTAL_EVENTS) {
        console.log(`[seed-500k] Progress: ${inserted.toLocaleString()} / ${TOTAL_EVENTS.toLocaleString()} events`);
      }
    }

    // 2a. Opening deposits (2,000 events)
    for (let i = 1; i <= ACCOUNT_COUNT; i++) {
      const accountId = `ACC-${String(i).padStart(4, "0")}`;
      const city = CITIES[i % CITIES.length];
      const id = `SEED-OPEN-${i}`;
      batch.push({
        event_id: `EVT-${crypto.randomUUID()}`,
        transaction_id: `TXN-${crypto.randomUUID()}`,
        account_id: accountId,
        type: "DEPOSIT",
        amount: 50000000, // $500,000.00 opening seed balance
        currency: "USD",
        timestamp: new Date(now - 31 * 24 * 60 * 60 * 1000),
        idempotency_key: id,
        client_idempotency_key: id,
        counterparty: null,
        geo_location: city,
        device_info: { device_id: `dev-${i}`, ip: "10.0.0.1" }
      });
    }

    // 2b. Inject 25 fraud bursts (25 * 7 = 175 events) for $setWindowFields testing
    for (let b = 1; b <= 25; b++) {
      const attackerId = `ACC-${String(b).padStart(4, "0")}`;
      const receiverId = `ACC-${String(b + 500).padStart(4, "0")}`;
      const burstBaseTime = now - b * 12 * 60 * 60 * 1000;
      const city = CITIES[b % CITIES.length];

      for (let k = 0; k < 7; k++) {
        const txId = `TXN-${crypto.randomUUID()}`;
        const key = `SEED-BURST-${b}-${k}`;
        const amount = k === 6 ? 250000 : 15000; // Last one also creates a spending spike
        batch.push({
          event_id: `EVT-${crypto.randomUUID()}`,
          transaction_id: txId,
          account_id: attackerId,
          type: "TRANSFER_OUT",
          amount,
          currency: "USD",
          timestamp: new Date(burstBaseTime + k * 8000), // 8 seconds apart
          idempotency_key: `${key}:OUT`,
          client_idempotency_key: key,
          counterparty: receiverId,
          geo_location: city,
          device_info: { device_id: `dev-${b}`, ip: "10.0.1.5" }
        });
      }
    }

    // 2c. Fill remaining events up to 500,000 with normal deposits, withdrawals, and transfers
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    let seq = 1;
    while (inserted + batch.length < TOTAL_EVENTS) {
      const remaining = TOTAL_EVENTS - (inserted + batch.length);
      const accIndex = randomInt(1, ACCOUNT_COUNT);
      const accountId = `ACC-${String(accIndex).padStart(4, "0")}`;
      const city = CITIES[accIndex % CITIES.length];
      const ts = new Date(now - randomInt(60000, thirtyDaysMs));

      // Create paired TRANSFER_OUT + TRANSFER_IN when at least 2 slots remain
      if (remaining >= 2 && seq % 2 === 0) {
        const peerIndex = (accIndex % ACCOUNT_COUNT) + 1;
        const peerId = `ACC-${String(peerIndex).padStart(4, "0")}`;
        const txId = `TXN-${crypto.randomUUID()}`;
        const key = `SEED-TX-${seq}`;
        const amount = randomInt(500, 25000);

        batch.push({
          event_id: `EVT-${crypto.randomUUID()}`,
          transaction_id: txId,
          account_id: accountId,
          type: "TRANSFER_OUT",
          amount,
          currency: "USD",
          timestamp: ts,
          idempotency_key: `${key}:OUT`,
          client_idempotency_key: key,
          counterparty: peerId,
          geo_location: city,
          device_info: { device_id: `dev-${accIndex}`, ip: "10.0.0.2" }
        });
        batch.push({
          event_id: `EVT-${crypto.randomUUID()}`,
          transaction_id: txId,
          account_id: peerId,
          type: "TRANSFER_IN",
          amount,
          currency: "USD",
          timestamp: ts,
          idempotency_key: `${key}:IN`,
          client_idempotency_key: key,
          counterparty: accountId,
          geo_location: city,
          device_info: { device_id: `dev-${accIndex}`, ip: "10.0.0.2" }
        });
      } else {
        const type = seq % 3 === 0 ? "WITHDRAWAL" : "DEPOSIT";
        const key = `SEED-SINGLE-${seq}`;
        batch.push({
          event_id: `EVT-${crypto.randomUUID()}`,
          transaction_id: `TXN-${crypto.randomUUID()}`,
          account_id: accountId,
          type,
          amount: randomInt(1000, 30000),
          currency: "USD",
          timestamp: ts,
          idempotency_key: key,
          client_idempotency_key: key,
          counterparty: null,
          geo_location: city,
          device_info: { device_id: `dev-${accIndex}`, ip: "10.0.0.3" }
        });
      }

      seq++;
      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
      }
    }
    await flushBatch();

    // ------------------------------------------------------------------------
    // Step 3: Materialize account_balances from all 500,000 events
    // ------------------------------------------------------------------------
    console.log("[seed-500k] Rebuilding account_balances via $group + $merge...");
    await db
      .collection("ledger_events")
      .aggregate(
        [
          { $sort: { account_id: 1, timestamp: 1, _id: 1 } },
          {
            $group: {
              _id: "$account_id",
              current_balance: {
                $sum: {
                  $cond: [
                    { $in: ["$type", ["DEPOSIT", "TRANSFER_IN"]] },
                    "$amount",
                    { $multiply: ["$amount", -1] }
                  ]
                }
              },
              version: { $sum: 1 },
              last_event_id: { $last: "$event_id" },
              currency: { $first: "$currency" }
            }
          },
          {
            $project: {
              _id: 0,
              account_id: "$_id",
              current_balance: 1,
              currency: 1,
              last_event_id: 1,
              version: 1,
              updated_at: "$$NOW"
            }
          },
          {
            $merge: {
              into: "account_balances",
              on: "account_id",
              whenMatched: "replace",
              whenNotMatched: "insert"
            }
          }
        ],
        { allowDiskUse: true }
      )
      .toArray();

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[seed-500k] Done! Seeded ${inserted.toLocaleString()} events in ${elapsedSec}s.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[seed-500k] Failed:", err);
  process.exit(1);
});
