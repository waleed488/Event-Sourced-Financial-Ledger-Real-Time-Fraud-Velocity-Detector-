// ============================================================================
// views/SendMoney.jsx
// Transfer form -> receipt. The receipt shows both ledger legs and lets you
// resubmit the identical request to prove idempotency (no double debit).
// ============================================================================

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { api, newIdempotencyKey } from "../api.js";
import { LOCATIONS, findLocation, formatMoney, toMinorUnits } from "../format.js";
import AccountPicker from "../components/AccountPicker.jsx";
import { Button, Card, CardHeader, EmptyState, Field, InlineAlert, inputClass } from "../components/ui.jsx";

function ReceiptRow({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-6 py-2.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`truncate text-right text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function TransferReceipt({ receipt, payee, replay, onReplay, onSendAnother, onViewActivity }) {
  const { result, payload, key } = receipt;

  return (
    <Card className="mx-auto max-w-2xl">
      {/* Summary */}
      <div className="border-b border-slate-200 px-8 py-8 text-center">
        <CircleCheck className="mx-auto h-10 w-10 text-emerald-600" strokeWidth={1.5} />
        <div className="mt-3 text-sm font-medium text-slate-500">Transfer complete</div>
        <div className="mt-1 text-3xl font-semibold text-slate-900 tabular-nums">{formatMoney(payload.amount)}</div>
        <div className="mt-1 text-sm text-slate-500">
          to {payee.holder_name} · <span className="font-mono">{payee.account_id}</span>
        </div>
      </div>

      {/* Details */}
      <div className="divide-y divide-slate-100 px-8 py-2">
        <ReceiptRow label="From" value={payload.fromAccountId} mono />
        <ReceiptRow label="To" value={payload.toAccountId} mono />
        <ReceiptRow label="Your new balance" value={formatMoney(result.sender_balance)} />
        <ReceiptRow label="Location" value={payload.geoLocation.city} />
        <ReceiptRow label="Transaction ID" value={result.transaction_id} mono />
        <ReceiptRow label="Idempotency key" value={key} mono />
      </div>

      {/* The two immutable events written in the same ACID transaction */}
      <div className="border-t border-slate-200 px-8 py-5">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Ledger entries written</div>
        <table className="mt-3 w-full text-xs">
          <tbody className="divide-y divide-slate-100">
            {result.events.map((event) => (
              <tr key={event.event_id}>
                <td className="py-2 font-mono text-slate-900">{event.type}</td>
                <td className="py-2 font-mono text-slate-600">{event.account_id}</td>
                <td className="py-2 font-mono text-slate-500">{event.idempotency_key.split(":").pop()}</td>
                <td className="py-2 text-right tabular-nums text-slate-900">{formatMoney(event.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Idempotency proof */}
      <div className="border-t border-slate-200 bg-slate-50 px-8 py-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium text-slate-900">Resubmit the same request</div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Sends the identical payload with the same Idempotency-Key, like a client retrying after a timeout.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onReplay}>
            Resubmit
          </Button>
        </div>
        {replay && (
          <div className="mt-3">
            <InlineAlert tone="success">
              {replay.idempotentReplay
                ? `Original transaction ${replay.transaction_id} returned. No second debit was made.`
                : "A new transaction was created."}
            </InlineAlert>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 px-8 py-4">
        <Button variant="secondary" onClick={onViewActivity}>
          View activity
        </Button>
        <Button onClick={onSendAnother}>Send another</Button>
      </div>
    </Card>
  );
}

export default function SendMoney({ account, onDataChanged, notify, navigate }) {
  const [payee, setPayee] = useState(null);
  const [amount, setAmount] = useState("");
  const [city, setCity] = useState("Karachi");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [replay, setReplay] = useState(null);

  if (!account) {
    return <EmptyState title="No account selected" description="Pick the paying account in the top-right corner first." />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const amountMinor = toMinorUnits(amount);
    if (!payee) return setError("Choose who you want to pay.");
    if (!amountMinor) return setError("Enter an amount greater than zero.");

    const payload = {
      fromAccountId: account.account_id,
      toAccountId: payee.account_id,
      amount: amountMinor,
      geoLocation: findLocation(city)
    };
    const key = newIdempotencyKey("TRF");

    setSubmitting(true);
    try {
      const result = await api.transfer(payload, key);
      setReceipt({ result, payload, key });
      setReplay(null);
      onDataChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReplay() {
    try {
      const result = await api.transfer(receipt.payload, receipt.key);
      setReplay(result);
      onDataChanged();
    } catch (err) {
      notify("error", "Resubmit failed", err.message);
    }
  }

  if (receipt) {
    return (
      <TransferReceipt
        receipt={receipt}
        payee={payee}
        replay={replay}
        onReplay={handleReplay}
        onSendAnother={() => {
          setReceipt(null);
          setAmount("");
        }}
        onViewActivity={() => navigate("overview")}
      />
    );
  }

  const isFrozen = account.status === "frozen";

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="New transfer" description="Money leaves your account and arrives in the recipient's in one atomic step." />
        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <Field label="From">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-slate-900">{account.holder_name}</div>
                <div className="font-mono text-xs text-slate-500">{account.account_id}</div>
              </div>
              <div className="text-sm tabular-nums text-slate-700">{formatMoney(account.current_balance, account.currency)}</div>
            </div>
          </Field>

          <Field label="To">
            <AccountPicker selected={payee} onSelect={setPayee} excludeId={account.account_id} placeholder="Search for a recipient" />
          </Field>

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

            <Field label="Device location" hint="Simulated, used by the impossible-travel rule.">
              <select value={city} onChange={(e) => setCity(e.target.value)} className={inputClass}>
                {LOCATIONS.map((loc) => (
                  <option key={loc.city} value={loc.city}>
                    {loc.city}, {loc.country}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {isFrozen && <InlineAlert>This account is frozen. The server will reject the transfer (HTTP 403).</InlineAlert>}
          {error && <InlineAlert>{error}</InlineAlert>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Processing…" : amount ? `Send ${formatMoney(toMinorUnits(amount) || 0)}` : "Send money"}
          </Button>
        </form>
      </Card>

      <Card className="h-fit lg:col-span-2">
        <CardHeader title="What happens when you press Send" />
        <ol className="space-y-4 p-6 text-sm text-slate-600">
          {[
            "A MongoDB transaction starts with snapshot reads and majority writes.",
            "Your balance is debited only if it covers the amount. Otherwise everything is rolled back.",
            "The recipient is credited and two immutable events, TRANSFER_OUT and TRANSFER_IN, are appended.",
            "After commit, the change stream picks up the event and runs the fraud rules."
          ].map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-700">
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
