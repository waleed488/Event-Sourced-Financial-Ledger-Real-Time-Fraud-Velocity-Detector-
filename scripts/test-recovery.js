// ============================================================================
// scripts/test-recovery.js
// Wipes account_balances completely, triggers $group + $merge rebuild from
// ledger_events alone, and verifies 100% exact match across all accounts.
// ============================================================================

import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

const API_URL = process.env.API_URL || "http://localhost:4000";
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    // 1. Capture live balances before wiping
    const beforeRows = await db.collection("account_balances").find({}).toArray();
    const beforeMap = new Map(beforeRows.map((r) => [r.account_id, r.current_balance]));
    console.log(`[test-recovery] Captured ${beforeRows.length} live balance records.`);

    // 2. Wipe account_balances read model completely
    await db.collection("account_balances").deleteMany({});
    const afterWipeCount = await db.collection("account_balances").countDocuments();
    assert.equal(afterWipeCount, 0, "account_balances should be empty after wipe");
    console.log("[test-recovery] Wiped account_balances (0 docs remaining).");

    // 3. Trigger $group + $merge rebuild via API
    const rebuildRes = await fetch(`${API_URL}/api/admin/rebuild-balances`, {
      method: "POST"
    }).then((r) => r.json());
    console.log("[test-recovery] Rebuild response:", rebuildRes);

    // 4. Verify via API audit endpoint
    const verifyRes = await fetch(`${API_URL}/api/admin/verify-balances`, {
      method: "POST"
    }).then((r) => r.json());
    console.log("[test-recovery] Verify response:", verifyRes);
    assert.equal(verifyRes.exact_match, true, "Rebuilt balances must match ledger_events exactly");

    // 5. Also confirm every pre-wipe balance matches post-rebuild balance
    const afterRows = await db.collection("account_balances").find({}).toArray();
    assert.equal(afterRows.length, beforeRows.length, "Account count must match pre-wipe count");

    for (const row of afterRows) {
      assert.equal(
        row.current_balance,
        beforeMap.get(row.account_id),
        `Mismatch on account ${row.account_id}`
      );
    }

    console.log("[test-recovery] PASSED: Exact balance recovery from ledger_events alone!");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[test-recovery] FAILED:", err);
  process.exit(1);
});
