// ============================================================================
// scripts/reset-clean.js
// Resets the database to a clean workspace with 3 starter accounts,
// 3 opening deposits, and 0 noisy alerts so you can test the banking UI cleanly.
// (Run seed-500k.js anytime later when you want to run the 500k ESR benchmark.)
// ============================================================================

import crypto from "node:crypto";
import { MongoClient } from "mongodb";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
const DB_NAME = process.env.DB_NAME || "financial_ledger";

const STARTER_ACCOUNTS = [
  { account_id: "ACC-1001", holder_name: "Waleed Ali Khan", balance: 500000 }, // $5,000.00
  { account_id: "ACC-1002", holder_name: "Ayinaa Haseeb", balance: 250000 },   // $2,500.00
  { account_id: "ACC-1003", holder_name: "Sara Ahmed", balance: 100000 }       // $1,000.00
];

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    console.log("[reset-clean] Clearing dummy/seed data...");
    await Promise.all([
      db.collection("accounts").deleteMany({}),
      db.collection("ledger_events").deleteMany({}),
      db.collection("account_balances").deleteMany({}),
      db.collection("fraud_alerts").deleteMany({}),
      db.collection("stream_checkpoints").deleteMany({})
    ]);

    const now = new Date();
    const accounts = [];
    const events = [];
    const balances = [];

    for (const item of STARTER_ACCOUNTS) {
      const eventId = `EVT-${crypto.randomUUID()}`;
      const txId = `TXN-${crypto.randomUUID()}`;
      const key = `INIT-${item.account_id}`;

      accounts.push({
        account_id: item.account_id,
        holder_name: item.holder_name,
        status: "active",
        currency: "USD",
        daily_limit: 500000, // $5,000.00 daily limit
        risk_profile: { tier: "standard", home_country: "PK" },
        created_at: now
      });

      events.push({
        event_id: eventId,
        transaction_id: txId,
        account_id: item.account_id,
        type: "DEPOSIT",
        amount: item.balance,
        currency: "USD",
        timestamp: now,
        idempotency_key: key,
        client_idempotency_key: key,
        counterparty: null,
        geo_location: { city: "Karachi", country: "PK", lat: 24.8607, lon: 67.0011 }
      });

      balances.push({
        account_id: item.account_id,
        current_balance: item.balance,
        currency: "USD",
        last_event_id: eventId,
        version: 1,
        updated_at: now
      });
    }

    await db.collection("accounts").insertMany(accounts);
    await db.collection("ledger_events").insertMany(events);
    await db.collection("account_balances").insertMany(balances);

    console.log("[reset-clean] Ready! Created 3 clean starter accounts (ACC-1001, ACC-1002, ACC-1003) and 0 alerts.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[reset-clean] Failed:", err);
  process.exit(1);
});
