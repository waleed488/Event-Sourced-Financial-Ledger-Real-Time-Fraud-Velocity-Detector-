// ============================================================================
// server.js
// Express application entry point. Connects to MongoDB replica set, starts
// the Change Stream fraud worker, and exposes REST + SSE routes.
// ============================================================================

import cors from "cors";
import express from "express";
import { closeDatabase, connectToDatabase } from "./config/db.js";
import accountsRouter from "./routes/accounts.js";
import adminRouter from "./routes/admin.js";
import alertsRouter from "./routes/alerts.js";
import transactionsRouter from "./routes/transactions.js";
import { startFraudWorker, stopFraudWorker } from "./services/fraudWorker.js";
import { AppError } from "./utils/errors.js";

const PORT = Number(process.env.PORT) || 4000;
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/accounts", accountsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/admin", adminRouter);

// Centralized error handler so every endpoint returns predictable JSON
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details }
    });
  }

  // MongoDB $jsonSchema validation failure (code 121)
  if (err.code === 121) {
    return res.status(400).json({
      error: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "Document violated MongoDB $jsonSchema validator.",
        details: err.errInfo?.details || null
      }
    });
  }

  console.error("[server] Unhandled error:", err);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: err.message || "Unexpected server error" }
  });
});

async function bootstrap() {
  await connectToDatabase();
  await startFraudWorker();

  const server = app.listen(PORT, () => {
    console.log(`[server] Financial Ledger API listening on http://localhost:${PORT}`);
  });

  async function shutdown() {
    console.log("\n[server] Shutting down...");
    await stopFraudWorker();
    await closeDatabase();
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
