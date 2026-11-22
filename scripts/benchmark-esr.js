// ============================================================================
// scripts/benchmark-esr.js
// Measures explain("executionStats") over 500,000 events BEFORE and AFTER
// ESR compound indexing (7 runs each, discarding run #1, reporting the median).
// ============================================================================

import { MongoClient } from "mongodb";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

const TARGET_ACCOUNT = "ACC-0005";

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
    : sorted[mid];
}

function getWinningStage(plan) {
  let node = plan;
  const stages = [];
  while (node) {
    if (node.stage) stages.push(node.stage);
    node = node.inputStage || (node.inputStages ? node.inputStages[0] : null);
  }
  return stages.join(" -> ");
}

async function runBenchmarkQuery(collection, label, queryFn) {
  const times = [];
  let lastStats = null;

  // 7 iterations: discard iteration 0 (cold cache), take median of runs 1..6
  for (let i = 0; i < 7; i++) {
    const exp = await queryFn(collection).explain("executionStats");
    lastStats = exp;
    if (i > 0) {
      times.push(exp.executionStats.executionTimeMillis);
    }
  }

  return {
    label,
    winningStage: getWinningStage(lastStats.queryPlanner.winningPlan),
    medianMs: median(times),
    docsExamined: lastStats.executionStats.totalDocsExamined,
    keysExamined: lastStats.executionStats.totalKeysExamined,
    nReturned: lastStats.executionStats.nReturned
  };
}

async function measureAll(collection, endDate) {
  const startDate15d = new Date(endDate.getTime() - 15 * 24 * 60 * 60 * 1000);

  // Query 1: ESR Fraud / Outgoing Velocity Lookback (Equality + Range + Sort)
  const q1 = await runBenchmarkQuery(collection, "Q1: Outgoing Velocity Lookback", (col) =>
    col
      .find({
        account_id: TARGET_ACCOUNT,
        type: "TRANSFER_OUT",
        timestamp: { $gte: startDate15d, $lte: endDate }
      })
      .sort({ timestamp: -1 })
  );

  // Query 2: Covered Query using ESR index (account_id, type, timestamp, amount) -> 0 docs examined!
  const q2 = await runBenchmarkQuery(collection, "Q2: Covered Amount Projection", (col) =>
    col
      .find(
        {
          account_id: TARGET_ACCOUNT,
          type: "TRANSFER_OUT",
          timestamp: { $gte: startDate15d, $lte: endDate }
        },
        { projection: { _id: 0, account_id: 1, timestamp: 1, amount: 1 } }
      )
      .sort({ timestamp: -1 })
  );

  // Query 3: Account Statement Audit Trail (latest 50 events)
  const q3 = await runBenchmarkQuery(collection, "Q3: Account Statement Top-50", (col) =>
    col.find({ account_id: TARGET_ACCOUNT }).sort({ timestamp: -1 }).limit(50)
  );

  return [q1, q2, q3];
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const collection = db.collection("ledger_events");

  try {
    const totalDocs = await collection.estimatedDocumentCount();
    console.log(`[benchmark-esr] Collection size: ${totalDocs.toLocaleString()} events`);
    const endDate = new Date();

    // ------------------------------------------------------------------------
    // Step 1: Drop query indexes (keep _id_ and unique idempotency_key)
    // ------------------------------------------------------------------------
    console.log("[benchmark-esr] Dropping ESR query indexes for BEFORE baseline...");
    for (const idxName of ["ix_ledger_esr_account_type_ts_amount", "ix_ledger_account_ts"]) {
      try {
        await collection.dropIndex(idxName);
      } catch (e) {
        // Ignore if not present
      }
    }

    const beforeResults = await measureAll(collection, endDate);

    // ------------------------------------------------------------------------
    // Step 2: Recreate ESR compound indexes
    // ------------------------------------------------------------------------
    console.log("[benchmark-esr] Building ESR compound indexes...");
    await collection.createIndex(
      { account_id: 1, type: 1, timestamp: -1, amount: 1 },
      { name: "ix_ledger_esr_account_type_ts_amount" }
    );
    await collection.createIndex(
      { account_id: 1, timestamp: -1 },
      { name: "ix_ledger_account_ts" }
    );

    const afterResults = await measureAll(collection, endDate);

    // ------------------------------------------------------------------------
    // Step 3: Print clean Markdown table for the report
    // ------------------------------------------------------------------------
    console.log("\n=== ESR BENCHMARK RESULTS (Median of 6 Warm Runs) ===");
    console.log(
      "| Query | Phase | Winning Stage | Median Time (ms) | Docs Examined | Keys Examined | Returned |"
    );
    console.log("|---|---|---|---|---|---|---|");

    for (let i = 0; i < beforeResults.length; i++) {
      const b = beforeResults[i];
      const a = afterResults[i];
      console.log(
        `| ${b.label} | BEFORE | ${b.winningStage} | ${b.medianMs} | ${b.docsExamined} | ${b.keysExamined} | ${b.nReturned} |`
      );
      console.log(
        `| ${a.label} | AFTER  | ${a.winningStage} | ${a.medianMs} | ${a.docsExamined} | ${a.keysExamined} | ${a.nReturned} |`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[benchmark-esr] FAILED:", err);
  process.exit(1);
});
