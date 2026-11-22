// ============================================================================
// setup-db.js
// Creates all 5 collections, applies strict $jsonSchema validators, and
// builds unique, ESR compound, and partial indexes.
// Run via: docker compose exec api node /app/scripts/setup-db.js
// ============================================================================

import { MongoClient } from "mongodb";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

// Helper: create a collection with a validator, or update validator if it already exists
async function ensureCollection(db, name, validator) {
  const existing = await db.listCollections({ name }).toArray();

  if (existing.length === 0) {
    const options = validator
      ? { validator, validationLevel: "strict", validationAction: "error" }
      : {};
    await db.createCollection(name, options);
    console.log(`[setup-db] Created collection: ${name}`);
    return;
  }

  if (validator) {
    await db.command({
      collMod: name,
      validator,
      validationLevel: "strict",
      validationAction: "error"
    });
    console.log(`[setup-db] Updated validator on existing collection: ${name}`);
  } else {
    console.log(`[setup-db] Collection already exists: ${name}`);
  }
}

// ----------------------------------------------------------------------------
// $jsonSchema Validators
// Note: Monetary fields use ["int", "long"] minor units (cents/paisa) so
// floating-point rounding drift can never happen.
// ----------------------------------------------------------------------------
const accountsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["account_id", "holder_name", "status", "currency", "daily_limit", "risk_profile", "created_at"],
    properties: {
      account_id: { bsonType: "string", minLength: 1 },
      holder_name: { bsonType: "string", minLength: 1 },
      status: { enum: ["active", "frozen"] },
      currency: { enum: ["USD", "PKR", "EUR"] },
      daily_limit: { bsonType: ["int", "long"], minimum: 0 },
      risk_profile: {
        bsonType: "object",
        required: ["tier", "home_country"],
        properties: {
          tier: { enum: ["low", "standard", "high"] },
          home_country: { bsonType: "string", minLength: 2 }
        }
      },
      created_at: { bsonType: "date" }
    }
  }
};

const ledgerEventsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "event_id",
      "transaction_id",
      "account_id",
      "type",
      "amount",
      "currency",
      "timestamp",
      "idempotency_key",
      "client_idempotency_key"
    ],
    properties: {
      event_id: { bsonType: "string", minLength: 1 },
      transaction_id: { bsonType: "string", minLength: 1 },
      account_id: { bsonType: "string", minLength: 1 },
      type: { enum: ["DEPOSIT", "WITHDRAWAL", "TRANSFER_OUT", "TRANSFER_IN"] },
      // All events store positive amounts; withdrawals/transfers_out are subtracted in queries
      amount: { bsonType: ["int", "long"], minimum: 1 },
      currency: { enum: ["USD", "PKR", "EUR"] },
      timestamp: { bsonType: "date" },
      idempotency_key: { bsonType: "string", minLength: 1 },
      client_idempotency_key: { bsonType: "string", minLength: 1 },
      geo_location: {
        bsonType: "object",
        required: ["lat", "lon"],
        properties: {
          city: { bsonType: "string" },
          country: { bsonType: "string" },
          lat: { bsonType: ["double", "int", "long"], minimum: -90, maximum: 90 },
          lon: { bsonType: ["double", "int", "long"], minimum: -180, maximum: 180 }
        }
      }
    }
  }
};

const accountBalancesValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["account_id", "current_balance", "currency", "version", "updated_at"],
    properties: {
      account_id: { bsonType: "string", minLength: 1 },
      // Hard database-level guard: balance can never go negative
      current_balance: { bsonType: ["int", "long"], minimum: 0 },
      currency: { enum: ["USD", "PKR", "EUR"] },
      version: { bsonType: ["int", "long"], minimum: 0 },
      updated_at: { bsonType: "date" }
    }
  }
};

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    // 1. Create collections and attach $jsonSchema validators
    await ensureCollection(db, "accounts", accountsValidator);
    await ensureCollection(db, "ledger_events", ledgerEventsValidator);
    await ensureCollection(db, "account_balances", accountBalancesValidator);
    await ensureCollection(db, "fraud_alerts", null);
    await ensureCollection(db, "stream_checkpoints", null);

    // 2. Create indexes on accounts
    await db.collection("accounts").createIndex(
      { account_id: 1 },
      { unique: true, name: "ux_accounts_account_id" }
    );

    // 3. Create indexes on ledger_events
    // 3a. Unique idempotency key per ledger event leg (e.g., "<key>:OUT", "<key>:IN")
    await db.collection("ledger_events").createIndex(
      { idempotency_key: 1 },
      { unique: true, name: "ux_ledger_idempotency_key" }
    );
    // 3b. Client idempotency lookup for returning original result on duplicate retries
    await db.collection("ledger_events").createIndex(
      { client_idempotency_key: 1 },
      { name: "ix_ledger_client_idempotency_key" }
    );
    // 3c. Primary ESR + Covered index: Equality (account_id, type) -> Sort/Range (timestamp) + Covered (amount)
    await db.collection("ledger_events").createIndex(
      { account_id: 1, type: 1, timestamp: -1, amount: 1 },
      { name: "ix_ledger_esr_account_type_ts_amount" }
    );
    // 3d. Account timeline & 24-hour lookback index across all event types
    await db.collection("ledger_events").createIndex(
      { account_id: 1, timestamp: -1 },
      { name: "ix_ledger_account_ts" }
    );

    // 4. Create indexes on account_balances
    await db.collection("account_balances").createIndex(
      { account_id: 1 },
      { unique: true, name: "ux_balances_account_id" }
    );

    // 5. Create indexes on fraud_alerts
    // 5a. Deduplicate alerts per account, rule, and time window
    await db.collection("fraud_alerts").createIndex(
      { dedup_key: 1 },
      { unique: true, name: "ux_alerts_dedup_key" }
    );
    // 5b. Partial ESR index: only indexes open alerts for fast dashboard & account lookup
    await db.collection("fraud_alerts").createIndex(
      { account_id: 1, detected_at: -1 },
      { partialFilterExpression: { status: "open" }, name: "px_alerts_open_account_ts" }
    );
    await db.collection("fraud_alerts").createIndex(
      { detected_at: -1 },
      { partialFilterExpression: { status: "open" }, name: "px_alerts_open_ts" }
    );

    console.log("[setup-db] All collections, validators, and indexes are ready.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[setup-db] Failed:", err);
  process.exit(1);
});
