// ============================================================================
// routes/accounts.js
// REST endpoints for accounts, live balances, status toggling, and ledger trail.
// ============================================================================

import { Router } from "express";
import {
  createAccount,
  getAccountEvents,
  getAccountWithBalance,
  listAccountsWithBalances,
  setAccountStatus
} from "../services/accountService.js";

const router = Router();

// Create account + initial 0 balance
router.post("/", async (req, res, next) => {
  try {
    const result = await createAccount(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// List accounts with live read-model balances
router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const search = String(req.query.search || "").trim();
    const accounts = await listAccountsWithBalances(limit, search);
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// Get single account + balance
router.get("/:accountId", async (req, res, next) => {
  try {
    const account = await getAccountWithBalance(req.params.accountId);
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// Freeze or activate an account
router.patch("/:accountId/status", async (req, res, next) => {
  try {
    const updated = await setAccountStatus(req.params.accountId, req.body.status);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Get ledger audit trail for an account (uses ESR compound index)
router.get("/:accountId/events", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const type = req.query.type || null;
    const events = await getAccountEvents(req.params.accountId, { type, limit });
    res.json({ account_id: req.params.accountId, events });
  } catch (err) {
    next(err);
  }
});

export default router;
