// ============================================================================
// services/accountService.js
// Handles account creation (with atomic balance initialization), status updates
// (active/frozen), and reading account balances & transaction history.
// ============================================================================

import { getClient, getDb } from "../config/db.js";
import { AppError, assertNonEmptyString } from "../utils/errors.js";

const VALID_CURRENCIES = ["USD", "PKR", "EUR"];
const VALID_STATUSES = ["active", "frozen"];

/**
 * Create a new account and its initial 0-balance snapshot atomically.
 */
export async function createAccount({
  accountId,
  holderName,
  currency = "USD",
  dailyLimit = 500000, // Default: $5,000.00 (in minor units)
  riskTier = "standard",
  homeCountry = "PK"
}) {
  assertNonEmptyString(accountId, "accountId");
  assertNonEmptyString(holderName, "holderName");

  if (!VALID_CURRENCIES.includes(currency)) {
    throw new AppError(400, "VALIDATION_ERROR", `currency must be one of: ${VALID_CURRENCIES.join(", ")}`);
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0) {
    throw new AppError(400, "VALIDATION_ERROR", "dailyLimit must be a non-negative integer.");
  }

  const client = getClient();
  const db = getDb();
  const session = client.startSession();
  const now = new Date();

  const accountDoc = {
    account_id: accountId.trim(),
    holder_name: holderName.trim(),
    status: "active",
    currency,
    daily_limit: dailyLimit,
    risk_profile: {
      tier: riskTier,
      home_country: homeCountry
    },
    created_at: now
  };

  const balanceDoc = {
    account_id: accountId.trim(),
    current_balance: 0,
    currency,
    last_event_id: null,
    version: 0,
    updated_at: now
  };

  try {
    // Run inside a transaction so an account can never exist without its balance record
    await session.withTransaction(
      async () => {
        await db.collection("accounts").insertOne(accountDoc, { session, maxTimeMS: 5000 });
        await db.collection("account_balances").insertOne(balanceDoc, { session, maxTimeMS: 5000 });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority", j: true },
        readPreference: "primary",
        maxCommitTimeMS: 10000
      }
    );
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(409, "ACCOUNT_EXISTS", `Account "${accountId}" already exists.`);
    }
    throw err;
  } finally {
    await session.endSession();
  }

  return { account: accountDoc, balance: balanceDoc };
}

/**
 * List accounts merged with their live read-model balances.
 * Optional search matches account_id or holder_name (case-insensitive).
 */
export async function listAccountsWithBalances(limit = 50, search = "") {
  const db = getDb();

  const filter = {};
  if (search) {
    // Escape regex special characters so user input is matched literally
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { account_id: { $regex: safeSearch, $options: "i" } },
      { holder_name: { $regex: safeSearch, $options: "i" } }
    ];
  }

  const accounts = await db
    .collection("accounts")
    .find(filter)
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();

  const accountIds = accounts.map((a) => a.account_id);
  const balances = await db
    .collection("account_balances")
    .find({ account_id: { $in: accountIds } })
    .toArray();

  // Map balances by account_id for simple O(1) lookup
  const balanceMap = new Map(balances.map((b) => [b.account_id, b]));

  return accounts.map((acc) => {
    const bal = balanceMap.get(acc.account_id);
    return {
      ...acc,
      current_balance: bal ? bal.current_balance : 0,
      version: bal ? bal.version : 0,
      balance_updated_at: bal ? bal.updated_at : null
    };
  });
}

/**
 * Get one account and its current balance.
 */
export async function getAccountWithBalance(accountId) {
  const db = getDb();
  const account = await db.collection("accounts").findOne({ account_id: accountId });
  if (!account) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", `Account "${accountId}" was not found.`);
  }

  const balance = await db.collection("account_balances").findOne({ account_id: accountId });
  return {
    ...account,
    current_balance: balance ? balance.current_balance : 0,
    version: balance ? balance.version : 0,
    last_event_id: balance ? balance.last_event_id : null,
    balance_updated_at: balance ? balance.updated_at : null
  };
}

/**
 * Freeze or activate an account.
 */
export async function setAccountStatus(accountId, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new AppError(400, "VALIDATION_ERROR", `status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const db = getDb();
  const result = await db.collection("accounts").findOneAndUpdate(
    { account_id: accountId },
    { $set: { status } },
    { returnDocument: "after" }
  );

  if (!result) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", `Account "${accountId}" was not found.`);
  }
  return result;
}

/**
 * Fetch recent ledger events for an account using the ESR compound index.
 */
export async function getAccountEvents(accountId, { type = null, limit = 50 } = {}) {
  const db = getDb();
  const filter = { account_id: accountId };
  if (type) {
    filter.type = type;
  }

  return db
    .collection("ledger_events")
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
}
