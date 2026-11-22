// ============================================================================
// views/OpenAccount.jsx
// Creates a customer account (account + zero-balance snapshot in one
// transaction), then optionally posts an opening deposit.
// ============================================================================

import { useState } from "react";
import { api, newIdempotencyKey } from "../api.js";
import { toMinorUnits } from "../format.js";
import { Button, Card, CardHeader, Field, InlineAlert, inputClass } from "../components/ui.jsx";

function generateAccountNumber() {
  return `ACC-${Math.floor(10000 + Math.random() * 90000)}`;
}

export default function OpenAccount({ onAccountOpened, notify }) {
  const [holderName, setHolderName] = useState("");
  const [accountId, setAccountId] = useState(generateAccountNumber);
  const [currency, setCurrency] = useState("USD");
  const [dailyLimit, setDailyLimit] = useState("5000");
  const [openingDeposit, setOpeningDeposit] = useState("1000");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const limitMinor = Math.round(Number(dailyLimit) * 100);
    const depositMinor = toMinorUnits(openingDeposit); // null when empty or zero

    if (!holderName.trim()) return setError("Enter the account holder's name.");
    if (!accountId.trim()) return setError("Enter an account number.");
    if (!Number.isFinite(limitMinor) || limitMinor < 0) return setError("Daily limit must be zero or more.");

    setSubmitting(true);
    try {
      // Step 1: create the account and its $0 balance record (single transaction on the server)
      await api.createAccount({
        accountId: accountId.trim(),
        holderName: holderName.trim(),
        currency,
        dailyLimit: limitMinor
      });

      // Step 2: optional opening deposit, written as a normal DEPOSIT ledger event
      if (depositMinor) {
        await api.deposit({ accountId: accountId.trim(), amount: depositMinor }, newIdempotencyKey("DEP"));
      }

      notify("success", "Account opened", `${holderName.trim()} · ${accountId.trim()}`);
      onAccountOpened(accountId.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader
        title="Account details"
        description="The account and its balance record are created together in one transaction."
      />
      <form onSubmit={handleSubmit} className="space-y-5 p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Account holder">
            <input
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="e.g. Ayesha Khan"
              className={inputClass}
            />
          </Field>

          <Field label="Account number">
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${inputClass} font-mono`} />
          </Field>

          <Field label="Currency">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
              <option value="USD">USD — US Dollar</option>
              <option value="PKR">PKR — Pakistani Rupee</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </Field>

          <Field label="Daily spending limit" hint="Outgoing payments above this in 24h raise an alert.">
            <input
              type="number"
              min="0"
              step="1"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
          </Field>
        </div>

        <Field label="Opening deposit" hint="Optional. Leave empty to open with a zero balance.">
          <input
            type="number"
            min="0"
            step="0.01"
            value={openingDeposit}
            onChange={(e) => setOpeningDeposit(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>

        {error && <InlineAlert>{error}</InlineAlert>}

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Opening account…" : "Open account"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
