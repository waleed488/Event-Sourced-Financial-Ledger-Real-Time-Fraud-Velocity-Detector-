// ============================================================================
// scripts/test-fraud.js
// Injects all 4 fraud patterns through the live API and verifies that the
// Change Stream fraudWorker raises alerts in < 2 seconds.
// ============================================================================

import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

const API_URL = process.env.API_URL || "http://localhost:4000";
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

const KARACHI = { city: "Karachi", country: "PK", lat: 24.8607, lon: 67.0011 };
const LONDON = { city: "London", country: "UK", lat: 51.5074, lon: -0.1278 };

async function postJson(path, body, key) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const runId = Date.now();
  const attackerId = `TEST-FRAUD-SRC-${runId}`;
  const muleId = `TEST-FRAUD-DST-${runId}`;

  console.log("[test-fraud] Setting up test accounts (daily_limit = $500 / 50,000)...");
  await postJson("/api/accounts", {
    accountId: attackerId,
    holderName: "Fraud Test Account",
    dailyLimit: 50000
  });
  await postJson("/api/accounts", { accountId: muleId, holderName: "Mule Account" });
  await postJson(
    "/api/transactions/deposits",
    { accountId: attackerId, amount: 500000 },
    `FR-DEP-${runId}`
  );

  // 1. Send 6 rapid small transfers from Karachi -> builds baseline + triggers BURST_VELOCITY
  console.log("[test-fraud] Sending 6 rapid transfers (BURST_VELOCITY)...");
  for (let i = 1; i <= 6; i++) {
    await postJson(
      "/api/transactions/transfers",
      { fromAccountId: attackerId, toAccountId: muleId, amount: 2000, geoLocation: KARACHI },
      `FR-BURST-${runId}-${i}`
    );
  }

  // 2. Send a 10x spike transfer -> triggers SPENDING_SPIKE
  console.log("[test-fraud] Sending $200 spike transfer (SPENDING_SPIKE)...");
  await postJson(
    "/api/transactions/transfers",
    { fromAccountId: attackerId, toAccountId: muleId, amount: 20000, geoLocation: KARACHI },
    `FR-SPIKE-${runId}`
  );

  // 3. Send a $400 transfer -> 24h total exceeds $500 daily limit -> DAILY_LIMIT_BREACH
  console.log("[test-fraud] Sending $400 transfer (DAILY_LIMIT_BREACH)...");
  await postJson(
    "/api/transactions/transfers",
    { fromAccountId: attackerId, toAccountId: muleId, amount: 40000, geoLocation: KARACHI },
    `FR-LIMIT-${runId}`
  );

  // 4. Immediately send a transfer from London -> triggers IMPOSSIBLE_TRAVEL
  console.log("[test-fraud] Sending immediate transfer from London (IMPOSSIBLE_TRAVEL)...");
  await postJson(
    "/api/transactions/transfers",
    { fromAccountId: attackerId, toAccountId: muleId, amount: 2500, geoLocation: LONDON },
    `FR-TRAVEL-${runId}`
  );

  // Allow Change Stream up to 2.5 seconds to process all alerts
  await new Promise((r) => setTimeout(r, 2500));

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const alerts = await db
    .collection("fraud_alerts")
    .find({ account_id: attackerId })
    .sort({ detected_at: 1 })
    .toArray();
  await client.close();

  const rules = new Set(alerts.map((a) => a.rule_triggered));
  console.log("[test-fraud] Alerts generated:");
  for (const a of alerts) {
    console.log(
      `  - ${a.rule_triggered} | severity=${a.severity} | latency=${a.detection_latency_ms}ms`
    );
  }

  for (const expectedRule of [
    "BURST_VELOCITY",
    "SPENDING_SPIKE",
    "DAILY_LIMIT_BREACH",
    "IMPOSSIBLE_TRAVEL"
  ]) {
    assert.ok(rules.has(expectedRule), `Missing expected fraud rule: ${expectedRule}`);
  }

  for (const alert of alerts) {
    assert.ok(
      alert.detection_latency_ms < 2000,
      `Detection latency ${alert.detection_latency_ms}ms exceeded 2000ms target`
    );
  }

  console.log("[test-fraud] PASSED: All 4 fraud rules triggered in under 2 seconds!");
}

main().catch((err) => {
  console.error("[test-fraud] FAILED:", err);
  process.exit(1);
});
