// ============================================================================
// config/db.js
// Manages the single shared MongoClient connection pool for the Express API.
// ============================================================================

import { MongoClient } from "mongodb";

let client = null;
let db = null;

/**
 * Connect once to the MongoDB 3-node replica set and reuse the pool.
 */
export async function connectToDatabase() {
  if (db) {
    return { client, db };
  }

  const mongoUri =
    process.env.MONGO_URI ||
    "mongodb://localhost:27027,localhost:27028,localhost:27029/?replicaSet=rs0";
  const dbName = process.env.DB_NAME || "financial_ledger";

  // maxPoolSize: 100 ensures 50+ concurrent transfers do not queue in Node
  client = new MongoClient(mongoUri, {
    maxPoolSize: 100,
    minPoolSize: 10,
    retryWrites: true,
    serverSelectionTimeoutMS: 5000
  });

  await client.connect();
  db = client.db(dbName);
  console.log(`[db] Connected to MongoDB database "${dbName}"`);
  return { client, db };
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call connectToDatabase() first.");
  }
  return db;
}

export function getClient() {
  if (!client) {
    throw new Error("MongoClient not initialized. Call connectToDatabase() first.");
  }
  return client;
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log("[db] MongoDB connection closed.");
  }
}
