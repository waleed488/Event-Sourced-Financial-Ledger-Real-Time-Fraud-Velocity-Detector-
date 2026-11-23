# Event-Sourced Financial Ledger & Real-Time Fraud Velocity Detector in MongoDB

**Course:** Advanced Database Systems — COMSATS University Islamabad, Abbottabad Campus  
**Team:** Waleed Ali Khan (`FA23BCS127`) & Ayinaa Haseeb Khan (`FA23BCS020`)

---

## Architecture Overview

- **Write Model (`ledger_events`):** Immutable append-only log of `DEPOSIT`, `WITHDRAWAL`, `TRANSFER_OUT`, and `TRANSFER_IN` events (stored in integer minor units, e.g., `10050` = `$100.50`).
- **Read Model (`account_balances`):** Materialized per-account balance updated atomically inside ACID transactions (`snapshot` read concern, `majority` write concern) and rebuildable from scratch via `$group` + `$merge`.
- **Real-Time Fraud Engine (`fraudWorker.js`):** Change Stream listener with saved resume tokens (`stream_checkpoints`) evaluating 4 rules (`BURST_VELOCITY`, `SPENDING_SPIKE`, `DAILY_LIMIT_BREACH`, `IMPOSSIBLE_TRAVEL`) and streaming live alerts over Server-Sent Events (`/api/alerts/stream`).
- **Analytical Fraud Backfill (`analyticsService.js`):** `$setWindowFields` rolling-window pipeline (`allowDiskUse: true`) for historical backfill over 500,000 events.

---

## Option A: Run Locally on Windows (MongoDB 8.0 + Node 22)

1. **Start the 3-node replica set (`rs0` on ports `27027–27029`):**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\start-local-rs.ps1
   ```
2. **Initialize collections, `$jsonSchema` validators, and ESR/partial indexes:**
   ```powershell
   cd backend
   npm install
   npm run setup-db
   ```
3. **Seed 500,000 events (keep the API stopped or `ENABLE_FRAUD_WORKER=false` during seeding):**
   ```powershell
   cd ..\scripts
   npm install
   node --env-file=../.env seed-500k.js
   ```
4. **Start the Backend API & Fraud Worker:**
   ```powershell
   cd ..\backend
   npm start
   ```
5. **Run Historical `$setWindowFields` Backfill (optional):**
   ```powershell
   Invoke-RestMethod -Method Post http://localhost:4000/api/admin/backfill-fraud
   ```
6. **Start the React Dashboard:**
   ```powershell
   cd ..\frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173`.

---

## Option B: Run via Docker Compose

```powershell
docker compose up -d
docker compose exec api node /app/scripts/setup-db.js
```

---

## Verification & Benchmark Suite

Run these with the API server running:

```powershell
cd scripts
node --env-file=../.env test-naive-baseline.js # Naive overwrite-in-place fails (-$1,500 overdraft)
node --env-file=../.env test-idempotency.js    # 10 parallel identical keys -> 1 transfer
node --env-file=../.env test-concurrency.js   # 50 parallel transfers -> 0 overdraft
node --env-file=../.env test-recovery.js      # Wipe account_balances -> $group+$merge rebuild -> exact match
node --env-file=../.env test-fraud.js         # Inject all 4 fraud rules -> <2s detection latency
node --env-file=../.env test-failover.js      # replSetStepDown mid-batch -> 0 partial transfers
node --env-file=../.env benchmark-esr.js      # Before/after ESR explain("executionStats") on 500k events
```

To stop the local replica set when finished:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-local-rs.ps1
```
