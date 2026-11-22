// ============================================================================
// views/DepositWithdraw.jsx
// Cash in / cash out for the active account. Withdrawals are rejected by the
// server if the balance is too low (conditional update inside a transaction).
// ============================================================================

import { useState } from "react";
import { api, newIdempotencyKey } from "../api.js";
import { LOCATIONS, findLocation, formatMoney, toMinorUnits } from "../format.js";
import { Button, Card, EmptyState, Field, InlineAlert, SegmentedControl, inputClass } from "../components/ui.jsx";

export default function DepositWithdraw({ account, params, onDataChanged }) {
  const [mode, setMode] = useState(params?.mode || "deposit");
  const [amount, setAmount] = useState("");
  const [city, setCity] = useState("Karachi");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  if (!account) {
    return <EmptyState title="No account selected" description="Pick an account in the top-right corner first." />;
  }

  const isDeposit = mode === "deposit";

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setResult(null);

    const amountMinor = toMinorUnits(amount);
    if (!amountMinor) return setError("Enter an amount greater than zero.");

    const payload = { accountId: account.account_id, amount: amountMinor, geoLocation: findLocation(city) };

    setSubmitting(true);
    try {
      const response = isDeposit
        ? await api.deposit(payload, newIdempotencyKey("DEP"))
        : await api.withdraw(payload, newIdempotencyKey("WDR"));

      setResult({ mode, amount: amountMinor, balance: response.balance, transactionId: response.transaction_id });
      setAmount("");
      onDataChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{isDeposit ? "Deposit cash" : "Withdraw cash"}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {isDeposit ? "Adds a DEPOSIT event and credits the balance." : "Adds a WITHDRAWAL event only if funds are sufficient."}
          </p>
        </div>
        <SegmentedControl
          value={mode}
          onChange={(value) => {
            setMode(value);
            setError("");
            setResult(null);
          }}
          options={[
            { value: "deposit", label: "Deposit" },
            { value: "withdraw", label: "Withdraw" }
          ]}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-6">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium text-slate-900">{account.holder_name}</div>
            <div className="font-mono text-xs text-slate-500">{account.account_id}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Current balance</div>
            <div className="text-sm font-medium tabular-nums text-slate-900">{formatMoney(account.current_balance, account.currency)}</div>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Amount">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} pl-7 tabular-nums`}
              />
            </div>
          </Field>

          <Field label="Branch / device location">
            <select value={city} onChange={(e) => setCity(e.target.value)} className={inputClass}>
              {LOCATIONS.map((loc) => (
                <option key={loc.city} value={loc.city}>
                  {loc.city}, {loc.country}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && <InlineAlert>{error}</InlineAlert>}
        {result && (
          <InlineAlert tone="success">
            {result.mode === "deposit" ? "Deposited" : "Withdrew"} {formatMoney(result.amount)}. New balance{" "}
            <span className="font-semibold">{formatMoney(result.balance)}</span>.
          </InlineAlert>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Processing…" : isDeposit ? "Deposit" : "Withdraw"}
        </Button>
      </form>
    </Card>
  );
}
