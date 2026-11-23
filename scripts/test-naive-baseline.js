// ============================================================================
// scripts/test-naive-baseline.js
// Demonstrates why naive "read balance -> check -> update in place" CRUD code
// fails under 50 concurrent $50 transfers from a $1,000 account:
//   - Race condition (TOCTOU) lets too many transfers pass the balance check.
//   - Final balance goes deeply negative and money is created out of thin air.
// Run this alongside test-concurrency.js to contrast broken vs. ACID design.
// ============================================================================

import { MongoClient } from "mongodb";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

async function naiveTransfer(col, fromId, toId, amount) {
  // Naive pattern: read balance, check in JS, then update both accounts separately
  const sender = await col.findOne({ account_id: fromId });
  if (!sender || sender.balance < amount) {
    return { ok: false, reason: "INSUFFICIENT_FUNDS" };
  }

  // Artificial tiny yield mimics real network/business logic between check and write
  await new Promise((r) => setTimeout(r, 10));

  await col.updateOne({ account_id: fromId }, { $inc: { balance: -amount } });
  await col.updateOne({ account_id: toId }, { $inc: { balance: amount } });
  return { ok: true };
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const naiveCol = db.collection("naive_accounts_demo");

  try {
    await naiveCol.deleteMany({});
    await naiveCol.insertMany([
      { account_id: "NAIVE-SRC", balance: 100000 }, // $1,000.00
      { account_id: "NAIVE-DST", balance: 0 }
    ]);

    console.log("[test-naive-baseline] Seeded NAIVE-SRC with $1,000.00 (100,000 cents).");
    console.log("[test-naive-baseline] Firing 50 parallel $50 transfers WITHOUT transactions...");

    const results = await Promise.all(
      Array.from({ length: 50 }, () => naiveTransfer(naiveCol, "NAIVE-SRC", "NAIVE-DST", 5000))
    );

    const passed = results.filter((r) => r.ok).length;
    const rejected = results.length - passed;

    const src = await naiveCol.findOne({ account_id: "NAIVE-SRC" });
    const dst = await naiveCol.findOne({ account_id: "NAIVE-DST" });

    console.log(`[test-naive-baseline] Transfers accepted: ${passed}, rejected: ${rejected}`);
    console.log(
      `[test-naive-baseline] BROKEN FINAL BALANCES -> NAIVE-SRC: $${(src.balance / 100).toFixed(2)}, NAIVE-DST: $${(
        dst.balance / 100
      ).toFixed(2)}`
    );

    if (src.balance < 0) {
      console.log(
        "[test-naive-baseline] DEMO PROVEN: Naive overwrite-in-place allowed an overdraft! Run test-concurrency.js to see the ACID ledger prevent it."
      );
    }
  } finally {
    await naiveCol.deleteMany({});
    await client.close();
  }
}

main().catch((err) => {
  console.error("[test-naive-baseline] Error:", err);
  process.exit(1);
});
