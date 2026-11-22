// ============================================================================
// routes/transactions.js
// REST endpoints for deposits, withdrawals, and atomic transfers.
// Accepts Idempotency-Key from HTTP header or request body.
// ============================================================================

import { Router } from "express";
import { depositFunds, transferFunds, withdrawFunds } from "../services/ledgerService.js";

const router = Router();

function getIdempotencyKey(req) {
  return req.header("Idempotency-Key") || req.body.idempotencyKey;
}

router.post("/deposits", async (req, res, next) => {
  try {
    const result = await depositFunds({
      accountId: req.body.accountId,
      amount: req.body.amount,
      idempotencyKey: getIdempotencyKey(req),
      geoLocation: req.body.geoLocation || null,
      deviceInfo: req.body.deviceInfo || null
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/withdrawals", async (req, res, next) => {
  try {
    const result = await withdrawFunds({
      accountId: req.body.accountId,
      amount: req.body.amount,
      idempotencyKey: getIdempotencyKey(req),
      geoLocation: req.body.geoLocation || null,
      deviceInfo: req.body.deviceInfo || null
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/transfers", async (req, res, next) => {
  try {
    const result = await transferFunds({
      fromAccountId: req.body.fromAccountId,
      toAccountId: req.body.toAccountId,
      amount: req.body.amount,
      idempotencyKey: getIdempotencyKey(req),
      geoLocation: req.body.geoLocation || null,
      deviceInfo: req.body.deviceInfo || null
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
