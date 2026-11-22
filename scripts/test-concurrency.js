// ============================================================================
// scripts/test-concurrency.js
// Fires 50 simultaneous $50 transfers ($2,500 attempted) from an account with
// exactly $1,000 balance.
// Pass criteria:
// 1. Exactly 20 succeed, 30 fail with 409 INSUFFICIENT_FUNDS.
// 2. Final sender balance is 0 (never negative).
// 3. Total money across sender + receiver equals initial $1,000.
// ============================================================================

import assert from "node:assert/strict";

const API_URL = process.env.API_URL || "http://localhost:4000";

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
  const srcId = `TEST-RACE-SRC-${runId}`;
  const dstId = `TEST-RACE-DST-${runId}`;

  console.log("[test-concurrency] Creating accounts and seeding $1,000.00 (100,000 minor units)...");
  await postJson("/api/accounts", { accountId: srcId, holderName: "Race Sender" });
  await postJson("/api/accounts", { accountId: dstId, holderName: "Race Receiver" });

  const dep = await postJson(
    "/api/transactions/deposits",
    { accountId: srcId, amount: 100000 },
    { "Idempotency-Key": `RACE-DEP-${runId}` }
  );
  assert.equal(dep.status, 201);

  console.log("[test-concurrency] Launching 50 parallel $50 transfers...");
  const startedAt = Date.now();
  const tasks = Array.from({ length: 50 }, (_, idx) =>
    postJson(
      "/api/transactions/transfers",
      { fromAccountId: srcId, toAccountId: dstId, amount: 5000 },
      { "Idempotency-Key": `RACE-TX-${runId}-${idx}` }
    )
  );

  const results = await Promise.all(tasks);
  const elapsedMs = Date.now() - startedAt;

  const succeeded = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 409).length;
  const other = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log(
    `[test-concurrency] Completed in ${elapsedMs}ms -> Succeeded: ${succeeded}, Rejected (409): ${rejected}, Other: ${other.length}`
  );
  if (other.length > 0) {
    console.error("[test-concurrency] Unexpected responses:", other);
  }

  const srcAccount = await fetch(`${API_URL}/api/accounts/${srcId}`).then((r) => r.json());
  const dstAccount = await fetch(`${API_URL}/api/accounts/${dstId}`).then((r) => r.json());

  console.log(
    `[test-concurrency] Final balances -> SRC: ${srcAccount.current_balance}, DST: ${dstAccount.current_balance}`
  );

  assert.equal(other.length, 0, "No unexpected errors allowed");
  assert.equal(succeeded, 20, "Exactly 20 transfers of $50 should succeed from $1,000");
  assert.equal(rejected, 30, "Exactly 30 transfers should reject with INSUFFICIENT_FUNDS");
  assert.equal(srcAccount.current_balance, 0, "Sender balance must be 0 and never negative");
  assert.equal(
    srcAccount.current_balance + dstAccount.current_balance,
    100000,
    "Total money conserved"
  );

  console.log("[test-concurrency] PASSED: Zero overdraft under 50 concurrent transfers!");
}

main().catch((err) => {
  console.error("[test-concurrency] FAILED:", err);
  process.exit(1);
});
