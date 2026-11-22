// ============================================================================
// services/ledgerService.js
// Core Write Engine: Deposits, Withdrawals, and Atomic Multi-Document Transfers.
//
// Key design guarantees:
// 1. Snapshot read concern + majority write concern inside withTransaction().
// 2. Deterministic account_id lock ordering on transfers to reduce WriteConflicts.
// 3. Idempotency keys (:OUT and :IN for transfers) so retries never double-post.
// 4. Plain AppError throws so business errors abort immediately (no 120s retry).
// ============================================================================

import crypto from "node:crypto";
import { getClient, getDb } from "../config/db.js";
import { AppError, assertNonEmptyString, assertPositiveInteger } from "../utils/errors.js";

const TX_OPTIONS = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority", j: true },
  readPreference: "primary",
  maxCommitTimeMS: 10000
};

/**
 * Build a clean, schema-compliant ledger event document.
 */
function buildLedgerEvent({
  eventId,
  transactionId,
  accountId,
  type,
  amount,
  currency,
  timestamp,
  idempotencyKey,
  clientIdempotencyKey,
  counterparty = null,
  geoLocation = null,
  deviceInfo = null
}) {
  const doc = {
    event_id: eventId,
    transaction_id: transactionId,
    account_id: accountId,
    type,
    amount,
    currency,
    timestamp,
    idempotency_key: idempotencyKey,
    client_idempotency_key: clientIdempotencyKey,
    counterparty
  };

  if (geoLocation && typeof geoLocation.lat === "number" && typeof geoLocation.lon === "number") {
    doc.geo_location = geoLocation;
  }
  if (deviceInfo) {
    doc.device_info = deviceInfo;
  }
  return doc;
}

/**
 * Look up any previously committed events for a client Idempotency-Key.
 */
async function findCommittedReplay(db, clientIdempotencyKey) {
  const existingEvents = await db
    .collection("ledger_events")
    .find({ client_idempotency_key: clientIdempotencyKey })
    .sort({ timestamp: 1 })
    .toArray();

  if (existingEvents.length === 0) {
    return null;
  }

  return {
    idempotentReplay: true,
    transaction_id: existingEvents[0].transaction_id,
    events: existingEvents
  };
}

/**
 * Helper to fetch and validate an active account inside a transaction.
 */
async function requireActiveAccount(db, session, accountId) {
  const account = await db
    .collection("accounts")
    .findOne({ account_id: accountId }, { session, maxTimeMS: 5000 });

  if (!account) {
    throw new AppError(404, "ACCOUNT_NOT_FOUND", `Account "${accountId}" does not exist.`);
  }
  if (account.status !== "active") {
    throw new AppError(403, "ACCOUNT_FROZEN", `Account "${accountId}" is frozen.`);
  }
  return account;
}

/**
 * Deposit positive minor-unit funds into an active account.
 */
export async function depositFunds({
  accountId,
  amount,
  idempotencyKey,
  geoLocation = null,
  deviceInfo = null
}) {
  assertNonEmptyString(accountId, "accountId");
  assertNonEmptyString(idempotencyKey, "idempotencyKey");
  assertPositiveInteger(amount, "amount");

  const db = getDb();
  const client = getClient();

  // Fast-path idempotency check before opening a session
  const existing = await findCommittedReplay(db, idempotencyKey);
  if (existing) {
    return existing;
  }

  const session = client.startSession();
  const transactionId = `TXN-${crypto.randomUUID()}`;
  const eventId = `EVT-${crypto.randomUUID()}`;
  let createdEvent = null;
  let updatedBalance = null;

  try {
    await session.withTransaction(async () => {
      const account = await requireActiveAccount(db, session, accountId);
      const now = new Date();

      createdEvent = buildLedgerEvent({
        eventId,
        transactionId,
        accountId,
        type: "DEPOSIT",
        amount,
        currency: account.currency,
        timestamp: now,
        idempotencyKey,
        clientIdempotencyKey: idempotencyKey,
        geoLocation,
        deviceInfo
      });

      await db.collection("ledger_events").insertOne(createdEvent, { session, maxTimeMS: 5000 });

      updatedBalance = await db.collection("account_balances").findOneAndUpdate(
        { account_id: accountId },
        {
          $inc: { current_balance: amount, version: 1 },
          $set: { last_event_id: eventId, updated_at: now }
        },
        { session, returnDocument: "after", maxTimeMS: 5000 }
      );
    }, TX_OPTIONS);

    return {
      idempotentReplay: false,
      transaction_id: transactionId,
      events: [createdEvent],
      balance: updatedBalance?.current_balance ?? null
    };
  } catch (err) {
    // Parallel duplicate Idempotency-Key hit the unique index -> return original committed tx
    if (err.code === 11000) {
      const replay = await findCommittedReplay(db, idempotencyKey);
      if (replay) return replay;
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Withdraw funds from an active account only if sufficient balance exists.
 */
export async function withdrawFunds({
  accountId,
  amount,
  idempotencyKey,
  geoLocation = null,
  deviceInfo = null
}) {
  assertNonEmptyString(accountId, "accountId");
  assertNonEmptyString(idempotencyKey, "idempotencyKey");
  assertPositiveInteger(amount, "amount");

  const db = getDb();
  const client = getClient();

  const existing = await findCommittedReplay(db, idempotencyKey);
  if (existing) {
    return existing;
  }

  const session = client.startSession();
  const transactionId = `TXN-${crypto.randomUUID()}`;
  const eventId = `EVT-${crypto.randomUUID()}`;
  let createdEvent = null;
  let updatedBalance = null;

  try {
    await session.withTransaction(async () => {
      const account = await requireActiveAccount(db, session, accountId);
      const now = new Date();

      // Conditional update ensures balance can never drop below 0
      updatedBalance = await db.collection("account_balances").findOneAndUpdate(
        { account_id: accountId, current_balance: { $gte: amount } },
        {
          $inc: { current_balance: -amount, version: 1 },
          $set: { last_event_id: eventId, updated_at: now }
        },
        { session, returnDocument: "after", maxTimeMS: 5000 }
      );

      if (!updatedBalance) {
        throw new AppError(409, "INSUFFICIENT_FUNDS", `Account "${accountId}" has insufficient funds.`);
      }

      createdEvent = buildLedgerEvent({
        eventId,
        transactionId,
        accountId,
        type: "WITHDRAWAL",
        amount,
        currency: account.currency,
        timestamp: now,
        idempotencyKey,
        clientIdempotencyKey: idempotencyKey,
        geoLocation,
        deviceInfo
      });

      await db.collection("ledger_events").insertOne(createdEvent, { session, maxTimeMS: 5000 });
    }, TX_OPTIONS);

    return {
      idempotentReplay: false,
      transaction_id: transactionId,
      events: [createdEvent],
      balance: updatedBalance?.current_balance ?? null
    };
  } catch (err) {
    if (err.code === 11000) {
      const replay = await findCommittedReplay(db, idempotencyKey);
      if (replay) return replay;
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Atomic peer-to-peer transfer:
 * Debits sender, credits receiver, and appends TRANSFER_OUT + TRANSFER_IN events.
 */
export async function transferFunds({
  fromAccountId,
  toAccountId,
  amount,
  idempotencyKey,
  geoLocation = null,
  deviceInfo = null
}) {
  assertNonEmptyString(fromAccountId, "fromAccountId");
  assertNonEmptyString(toAccountId, "toAccountId");
  assertNonEmptyString(idempotencyKey, "idempotencyKey");
  assertPositiveInteger(amount, "amount");

  if (fromAccountId === toAccountId) {
    throw new AppError(400, "VALIDATION_ERROR", "Sender and receiver accounts must be different.");
  }

  const db = getDb();
  const client = getClient();

  const existing = await findCommittedReplay(db, idempotencyKey);
  if (existing) {
    return existing;
  }

  const session = client.startSession();
  const transactionId = `TXN-${crypto.randomUUID()}`;
  const outEventId = `EVT-${crypto.randomUUID()}`;
  const inEventId = `EVT-${crypto.randomUUID()}`;
  let outEvent = null;
  let inEvent = null;
  let senderAfter = null;
  let receiverAfter = null;

  try {
    await session.withTransaction(async () => {
      // Step 1: Verify both accounts exist and are active
      const fromAccount = await requireActiveAccount(db, session, fromAccountId);
      const toAccount = await requireActiveAccount(db, session, toAccountId);

      if (fromAccount.currency !== toAccount.currency) {
        throw new AppError(400, "CURRENCY_MISMATCH", "Cross-currency transfers are out of scope.");
      }

      const now = new Date();

      // Step 2: Update balances in deterministic account_id order to reduce deadlocks
      async function debitSender() {
        senderAfter = await db.collection("account_balances").findOneAndUpdate(
          { account_id: fromAccountId, current_balance: { $gte: amount } },
          {
            $inc: { current_balance: -amount, version: 1 },
            $set: { last_event_id: outEventId, updated_at: now }
          },
          { session, returnDocument: "after", maxTimeMS: 5000 }
        );
        if (!senderAfter) {
          throw new AppError(
            409,
            "INSUFFICIENT_FUNDS",
            `Account "${fromAccountId}" does not have enough balance for transfer.`
          );
        }
      }

      async function creditReceiver() {
        receiverAfter = await db.collection("account_balances").findOneAndUpdate(
          { account_id: toAccountId },
          {
            $inc: { current_balance: amount, version: 1 },
            $set: { last_event_id: inEventId, updated_at: now }
          },
          { session, returnDocument: "after", maxTimeMS: 5000 }
        );
      }

      if (fromAccountId < toAccountId) {
        await debitSender();
        await creditReceiver();
      } else {
        await creditReceiver();
        await debitSender(); // If this throws INSUFFICIENT_FUNDS, MongoDB rolls back creditReceiver()!
      }

      // Step 3: Append both immutable ledger events with leg-suffixed idempotency keys
      outEvent = buildLedgerEvent({
        eventId: outEventId,
        transactionId,
        accountId: fromAccountId,
        type: "TRANSFER_OUT",
        amount,
        currency: fromAccount.currency,
        timestamp: now,
        idempotencyKey: `${idempotencyKey}:OUT`,
        clientIdempotencyKey: idempotencyKey,
        counterparty: toAccountId,
        geoLocation,
        deviceInfo
      });

      inEvent = buildLedgerEvent({
        eventId: inEventId,
        transactionId,
        accountId: toAccountId,
        type: "TRANSFER_IN",
        amount,
        currency: toAccount.currency,
        timestamp: now,
        idempotencyKey: `${idempotencyKey}:IN`,
        clientIdempotencyKey: idempotencyKey,
        counterparty: fromAccountId,
        geoLocation,
        deviceInfo
      });

      await db
        .collection("ledger_events")
        .insertMany([outEvent, inEvent], { session, maxTimeMS: 5000 });
    }, TX_OPTIONS);

    return {
      idempotentReplay: false,
      transaction_id: transactionId,
      events: [outEvent, inEvent],
      sender_balance: senderAfter?.current_balance ?? null,
      receiver_balance: receiverAfter?.current_balance ?? null
    };
  } catch (err) {
    // Handle concurrent duplicate Idempotency-Key safely outside the aborted transaction
    if (err.code === 11000) {
      const replay = await findCommittedReplay(db, idempotencyKey);
      if (replay) return replay;
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
