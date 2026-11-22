// ============================================================================
// scripts/test-idempotency.js
// Fires 10 parallel transfer requests with the EXACT same Idempotency-Key.
// Pass criterion: Only 1 transfer commits (exact 10,000 debit, 2 ledger events).
// ============================================================================

import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

const API_URL = process.env.API_URL || "http://localhost:4000";
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  const runId = Date.now();
  const accA = `TEST-IDEM-A-${runId}`;
  const accB = `TEST-IDEM-B-${runId}`;
  const sharedKey = `IDEM-SHARED-${runId}`;

  console.log("[test-idempotency] Creating test accounts and depositing $1,000...");
  await postJson("/api/accounts", { accountId: accA, holderName: "Idem Sender" });
  await postJson("/api/accounts", { accountId: accB, holderName: "Idem Receiver" });
  await postJson(
    "/api/transactions/deposits",
    { accountId: accA, amount: 100000 },
    { "Idempotency-Key": `DEP-${runId}` }
  );

  console.log("[test-idempotency] Firing 10 parallel requests with identical Idempotency-Key...");
  const requests = Array.from({ length: 10 }, () =>
    postJson(
      "/api/transactions/transfers",
      { fromAccountId: accA, toAccountId: accB, amount: 10000 },
      { "Idempotency-Key": sharedKey }
    )
  );

  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  console.log("[test-idempotency] HTTP statuses:", statuses);

  // Every request should succeed with 201 (first) or 200 (replay)
  assert.ok(statuses.every((s) => s === 200 || s === 201), "Unexpected error status during idempotency test");

  const balA = await fetch(`${API_URL}/api/accounts/${accA}`).then((r) => r.json());
  const balB = await fetch(`${API_URL}/api/accounts/${accB}`).then((r) => r.json());

  assert.equal(balA.current_balance, 90000, "Sender balance should be debited exactly once");
  assert.equal(balB.current_balance, 10000, "Receiver balance should be credited exactly once");

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const eventCount = await db
    .collection("ledger_events")
    .countDocuments({ client_idempotency_key: sharedKey });
  await client.close();

  assert.equal(eventCount, 2, "Expected exactly 2 ledger events (TRANSFER_OUT + TRANSFER_IN)");
  console.log("[test-idempotency] PASSED: 10 parallel retries resulted in exactly 1 transfer.");
}

main().catch((err) => {
  console.error("[test-idempotency] FAILED:", err);
  process.exit(1);
});
