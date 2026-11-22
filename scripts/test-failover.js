// ============================================================================
// scripts/test-failover.js
// Runs a batch of transfers while forcing the replica set PRIMARY to step down
// (replSetStepDown). Verifies zero partial transfers & exact consistency.
// ============================================================================

import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

const API_URL = process.env.API_URL || "http://localhost:4000";
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

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
  const accA = `TEST-FAIL-A-${runId}`;
  const accB = `TEST-FAIL-B-${runId}`;

  await postJson("/api/accounts", { accountId: accA, holderName: "Failover Sender" });
  await postJson("/api/accounts", { accountId: accB, holderName: "Failover Receiver" });
  await postJson(
    "/api/transactions/deposits",
    { accountId: accA, amount: 200000 },
    `FAIL-DEP-${runId}`
  );

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  console.log("[test-failover] Starting 20 sequential transfers and triggering replSetStepDown...");

  let succeeded = 0;
  let failed = 0;

  for (let i = 1; i <= 20; i++) {
    // At transfer #6, force the current PRIMARY to step down for 15 seconds
    if (i === 6) {
      console.log("[test-failover] >>> Stepping down PRIMARY (replSetStepDown: 15) <<<");
      try {
        await db.admin().command({ replSetStepDown: 15, force: true });
      } catch (err) {
        // Step-down closes the admin connection intentionally; that is expected!
        console.log("[test-failover] Step-down triggered (connection cycled during election).");
      }
    }

    try {
      const res = await postJson(
        "/api/transactions/transfers",
        { fromAccountId: accA, toAccountId: accB, amount: 5000 },
        `FAIL-TX-${runId}-${i}`
      );
      if (res.status === 201 || res.status === 200) {
        succeeded++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
    }
  }

  // Wait briefly for cluster topology to settle, then verify zero partial transfers
  await new Promise((r) => setTimeout(r, 3000));

  const outCount = await db
    .collection("ledger_events")
    .countDocuments({ account_id: accA, type: "TRANSFER_OUT" });
  const inCount = await db
    .collection("ledger_events")
    .countDocuments({ account_id: accB, type: "TRANSFER_IN" });

  const balA = await fetch(`${API_URL}/api/accounts/${accA}`).then((r) => r.json());
  const balB = await fetch(`${API_URL}/api/accounts/${accB}`).then((r) => r.json());

  await client.close();

  console.log(
    `[test-failover] Transfers succeeded=${succeeded}, failed=${failed} | OUT=${outCount}, IN=${inCount}`
  );
  console.log(
    `[test-failover] Balances -> A=${balA.current_balance}, B=${balB.current_balance}, Sum=${
      balA.current_balance + balB.current_balance
    }`
  );

  assert.equal(outCount, inCount, "Every TRANSFER_OUT must have a matching TRANSFER_IN (no partial transfers)");
  assert.equal(balA.current_balance + balB.current_balance, 200000, "Total money must be conserved");

  console.log("[test-failover] PASSED: Zero partial transfers during PRIMARY failover!");
}

main().catch((err) => {
  console.error("[test-failover] FAILED:", err);
  process.exit(1);
});
