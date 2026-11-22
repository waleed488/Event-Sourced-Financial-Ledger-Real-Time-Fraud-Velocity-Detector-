// ============================================================================
// frontend/src/components/TransferPanel.jsx
// Clean tabbed money movement & fraud simulation console.
// Uses account dropdowns (and auto-selects valid accounts) so fromAccountId /
// toAccountId are never accidentally blank.
// ============================================================================

import { useEffect, useState } from "react";
import { formatMoney } from "../api.js";

const KARACHI = { city: "Karachi", country: "PK", lat: 24.8607, lon: 67.0011 };
const LONDON = { city: "London", country: "UK", lat: 51.5074, lon: -0.1278 };

export default function TransferPanel({
  accounts,
  onExecuteTransfer,
  onExecuteDeposit,
  onExecuteWithdraw,
  onSimulateBurst,
  onSimulateImpossibleTravel,
  busyAction
}) {
  const [tab, setTab] = useState("transfer"); // transfer | deposit | withdraw | demo
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amountDollars, setAmountDollars] = useState("25.00");
  const [localError, setLocalError] = useState("");

  // Auto-select valid default accounts whenever the account list loads or updates
  useEffect(() => {
    if (accounts.length === 0) return;

    const fundedAccount =
      accounts.find((a) => a.status === "active" && a.current_balance > 0) || accounts[0];
    const fallbackPeer =
      accounts.find((a) => a.account_id !== fundedAccount.account_id) || accounts[0];

    if (!fromId || !accounts.some((a) => a.account_id === fromId)) {
      setFromId(fundedAccount.account_id);
    }
    if (!toId || !accounts.some((a) => a.account_id === toId)) {
      setToId(fallbackPeer.account_id);
    }
  }, [accounts, fromId, toId]);

  function parseMinorUnits() {
    const val = Math.round(Number(amountDollars) * 100);
    if (!Number.isFinite(val) || val <= 0) {
      setLocalError("Enter a valid positive amount (e.g. 25.00).");
      return null;
    }
    return val;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError("");

    const amount = parseMinorUnits();
    if (!amount) return;

    if (tab === "transfer") {
      if (!fromId || !toId) {
        setLocalError("Select both a sender and a receiver account.");
        return;
      }
      if (fromId === toId) {
        setLocalError("Sender and receiver accounts must be different.");
        return;
      }
      await onExecuteTransfer({
        fromAccountId: fromId,
        toAccountId: toId,
        amount,
        geoLocation: KARACHI
      });
    } else if (tab === "deposit") {
      if (!fromId) {
        setLocalError("Select an account to deposit into.");
        return;
      }
      await onExecuteDeposit({ accountId: fromId, amount, geoLocation: KARACHI });
    } else if (tab === "withdraw") {
      if (!fromId) {
        setLocalError("Select an account to withdraw from.");
        return;
      }
      await onExecuteWithdraw({ accountId: fromId, amount, geoLocation: KARACHI });
    }
  }

  const tabs = [
    { id: "transfer", label: "Transfer" },
    { id: "deposit", label: "Deposit" },
    { id: "withdraw", label: "Withdraw" },
    { id: "demo", label: "Fraud Demo" }
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header + Segmented Tabs */}
      <div className="border-b border-slate-200 px-5 pt-4">
        <h2 className="text-sm font-semibold text-slate-900">Transaction & Simulation Console</h2>
        <div className="mt-3 flex gap-4">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setLocalError("");
                setTab(item.id);
              }}
              className={`border-b-2 pb-2.5 text-xs font-medium transition ${
                tab === item.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {localError && (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {localError}
          </div>
        )}

        {tab !== "demo" ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {tab === "transfer" ? "From Account (Sender)" : "Account"}
              </label>
              <select
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
              >
                {accounts.length === 0 && <option value="">No accounts loaded</option>}
                {accounts.map((acc) => (
                  <option key={acc.account_id} value={acc.account_id}>
                    {acc.account_id} — {acc.holder_name} ({formatMoney(acc.current_balance, acc.currency)})
                  </option>
                ))}
              </select>
            </div>

            {tab === "transfer" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  To Account (Receiver)
                </label>
                <select
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
                >
                  {accounts.length === 0 && <option value="">No accounts loaded</option>}
                  {accounts.map((acc) => (
                    <option key={acc.account_id} value={acc.account_id}>
                      {acc.account_id} — {acc.holder_name} ({formatMoney(acc.current_balance, acc.currency)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Amount (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={busyAction !== null || accounts.length === 0}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {busyAction === "tx"
                ? "Processing ACID Transaction..."
                : tab === "transfer"
                ? "Execute Atomic Transfer"
                : tab === "deposit"
                ? "Post Deposit Event"
                : "Execute Withdrawal"}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              Trigger live attacks from <span className="font-mono font-medium">{fromId || "-"}</span>{" "}
              to <span className="font-mono font-medium">{toId || "-"}</span> and watch the Change Stream
              flag them in real time below.
            </p>

            <button
              type="button"
              disabled={busyAction !== null || !fromId || !toId || fromId === toId}
              onClick={() =>
                onSimulateBurst({ fromAccountId: fromId, toAccountId: toId, geoLocation: KARACHI })
              }
              className="w-full rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-left transition hover:bg-rose-100 disabled:opacity-50"
            >
              <div className="text-xs font-semibold text-rose-800">
                Trigger Burst Velocity (6 x $10.00 rapid transfers)
              </div>
              <div className="mt-0.5 text-[11px] text-rose-600">
                Fires 6 consecutive outgoing transfers inside 2 minutes → HIGH alert
              </div>
            </button>

            <button
              type="button"
              disabled={busyAction !== null || !fromId || !toId || fromId === toId}
              onClick={() =>
                onSimulateImpossibleTravel({
                  fromAccountId: fromId,
                  toAccountId: toId,
                  originGeo: KARACHI,
                  distantGeo: LONDON
                })
              }
              className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-left transition hover:bg-amber-100 disabled:opacity-50"
            >
              <div className="text-xs font-semibold text-amber-900">
                Trigger Impossible Travel (Karachi → London)
              </div>
              <div className="mt-0.5 text-[11px] text-amber-700">
                Sends 2 back-to-back transfers 6,300 km apart → HIGH alert
              </div>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
