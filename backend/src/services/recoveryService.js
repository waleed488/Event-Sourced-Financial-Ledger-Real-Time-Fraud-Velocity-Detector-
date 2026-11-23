// ============================================================================
// services/recoveryService.js
// CQRS Read-Model Rebuild & Drift Audit using $group + $merge.
//
// NOTE: rebuildBalances() is an administrative / offline recovery operation.
// Running it concurrently during active live writes can cause transient drift.
// ============================================================================

import { getDb } from "../config/db.js";

/**
 * Shared aggregation pipeline that computes exact account balances directly
 * from the immutable ledger_events write model.
 */
function buildLedgerAggregationStages() {
  return [
    // Step 1: Sort deterministically (with _id tie-breaker for identical timestamps)
    { $sort: { account_id: 1, timestamp: 1, _id: 1 } },
    // Step 2: Sum signed amounts (DEPOSIT/TRANSFER_IN = +, WITHDRAWAL/TRANSFER_OUT = -)
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
    // Step 3: Shape documents to match the account_balances schema
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
    }
  ];
}

/**
 * Rebuild account_balances from ledger_events alone using $group + $merge.
 */
export async function rebuildBalances() {
  const db = getDb();
  const startedAt = Date.now();

  const pipeline = [
    ...buildLedgerAggregationStages(),
    {
      $merge: {
        into: "account_balances",
        on: "account_id",
        whenMatched: "replace",
        whenNotMatched: "insert"
      }
    }
  ];

  // allowDiskUse supports sorting/grouping 500,000+ events cleanly
  await db.collection("ledger_events").aggregate(pipeline, { allowDiskUse: true }).toArray();

  // Ensure accounts that have zero ledger events still have a 0-balance row
  const accounts = await db
    .collection("accounts")
    .find({}, { projection: { account_id: 1, currency: 1 } })
    .toArray();

  const existingIds = new Set(
    (await db.collection("account_balances").find({}, { projection: { account_id: 1 } }).toArray()).map(
      (b) => b.account_id
    )
  );

  const missingBalances = accounts
    .filter((acc) => !existingIds.has(acc.account_id))
    .map((acc) => ({
      account_id: acc.account_id,
      current_balance: 0,
      currency: acc.currency,
      last_event_id: null,
      version: 0,
      updated_at: new Date()
    }));

  if (missingBalances.length > 0) {
    await db.collection("account_balances").insertMany(missingBalances, { ordered: false });
  }

  return {
    rebuilt_accounts: accounts.length,
    zero_event_accounts_restored: missingBalances.length,
    duration_ms: Date.now() - startedAt
  };
}

/**
 * Verify live account_balances against ledger_events safely by rebuilding into
 * a separate "balances_rebuilt" collection via $merge and diffing them.
 * Does NOT overwrite account_balances.
 */
export async function verifyBalances() {
  const db = getDb();

  // Ensure the staging collection has a unique key for $merge (on: "account_id")
  await db
    .collection("balances_rebuilt")
    .createIndex({ account_id: 1 }, { unique: true, name: "ux_rebuilt_account_id" });
  await db.collection("balances_rebuilt").deleteMany({});

  await db
    .collection("ledger_events")
    .aggregate(
      [
        ...buildLedgerAggregationStages(),
        {
          $merge: {
            into: "balances_rebuilt",
            on: "account_id",
            whenMatched: "replace",
            whenNotMatched: "insert"
          }
        }
      ],
      { allowDiskUse: true }
    )
    .toArray();

  const liveRows = await db.collection("account_balances").find({}).toArray();
  const liveMap = new Map(liveRows.map((row) => [row.account_id, row]));

  const expectedRows = await db.collection("balances_rebuilt").find({}).toArray();
  const expectedMap = new Map(expectedRows.map((row) => [row.account_id, row]));

  const allAccounts = await db
    .collection("accounts")
    .find({}, { projection: { account_id: 1 } })
    .toArray();

  const mismatches = [];

  for (const acc of allAccounts) {
    const id = acc.account_id;
    const live = liveMap.get(id);
    const expected = expectedMap.get(id) || { current_balance: 0, version: 0 };

    const liveBalance = live ? live.current_balance : null;
    const liveVersion = live ? live.version : null;

    if (liveBalance !== expected.current_balance || liveVersion !== expected.version) {
      mismatches.push({
        account_id: id,
        live_balance: liveBalance,
        expected_balance: expected.current_balance,
        live_version: liveVersion,
        expected_version: expected.version
      });
    }
  }

  return {
    total_accounts: allAccounts.length,
    matched: allAccounts.length - mismatches.length,
    mismatched: mismatches.length,
    exact_match: mismatches.length === 0,
    mismatches: mismatches.slice(0, 20) // Return up to 20 examples if any drift exists
  };
}
