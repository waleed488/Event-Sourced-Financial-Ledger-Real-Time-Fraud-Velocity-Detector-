// ============================================================================
// frontend/src/components/AccountsPanel.jsx
// Displays the CQRS account_balances read model with search, account creation,
// status freeze/activate controls, and $group + $merge rebuild/verify triggers.
// ============================================================================

import { useState } from "react";
import { formatMoney } from "../api.js";

export default function AccountsPanel({
  accounts,
  selectedAccount,
  onSelectAccount,
  onCreateAccount,
  onToggleStatus,
  onRebuild,
  onVerify,
  busyAction
}) {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newAccId, setNewAccId] = useState("");
  const [newHolder, setNewHolder] = useState("");
  const [newDailyLimitDollars, setNewDailyLimitDollars] = useState("5000");

  const filtered = accounts.filter((acc) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      acc.account_id.toLowerCase().includes(q) ||
      acc.holder_name.toLowerCase().includes(q)
    );
  });

  async function handleCreateSubmit(e) {
    e.preventDefault();
    const ok = await onCreateAccount({
      accountId: newAccId.trim(),
      holderName: newHolder.trim(),
      dailyLimit: Math.round(Number(newDailyLimitDollars || 5000) * 100)
    });
    if (ok) {
      setNewAccId("");
      setNewHolder("");
      setShowCreate(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header & CQRS Admin Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Account Balances (CQRS Read Model)
          </h2>
          <p className="text-xs text-slate-500">
            Click any row to inspect its immutable ledger audit trail
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {showCreate ? "Cancel" : "+ New Account"}
          </button>
          <button
            onClick={onVerify}
            disabled={busyAction !== null}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {busyAction === "verify" ? "Verifying..." : "Verify Parity"}
          </button>
          <button
            onClick={onRebuild}
            disabled={busyAction !== null}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busyAction === "rebuild" ? "Rebuilding..." : "Rebuild ($group + $merge)"}
          </button>
        </div>
      </div>

      {/* Collapsible New Account Form */}
      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="grid grid-cols-1 gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3 sm:grid-cols-4"
        >
          <input
            required
            placeholder="Account ID (e.g. ACC-9001)"
            value={newAccId}
            onChange={(e) => setNewAccId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          />
          <input
            required
            placeholder="Holder Name"
            value={newHolder}
            onChange={(e) => setNewHolder(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          />
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Daily Limit ($)"
            value={newDailyLimitDollars}
            onChange={(e) => setNewDailyLimitDollars(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
          >
            Create Account
          </button>
        </form>
      )}

      {/* Search Filter */}
      <div className="border-b border-slate-100 px-5 py-2.5">
        <input
          type="text"
          placeholder="Filter by Account ID or Holder Name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-medium">Account</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Balance</th>
              <th className="px-3 py-2.5 text-right font-medium">Version</th>
              <th className="px-5 py-2.5 text-right font-medium">Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.slice(0, 25).map((acc) => {
              const isSelected = acc.account_id === selectedAccount;
              const isActive = acc.status === "active";
              return (
                <tr
                  key={acc.account_id}
                  onClick={() => onSelectAccount(acc.account_id)}
                  className={`cursor-pointer transition ${
                    isSelected ? "bg-indigo-50/70" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-5 py-2.5">
                    <div className="font-mono font-medium text-slate-900">{acc.account_id}</div>
                    <div className="text-[11px] text-slate-500">{acc.holder_name}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        isActive
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                          : "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20"
                      }`}
                    >
                      {acc.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                    {formatMoney(acc.current_balance, acc.currency)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500">
                    v{acc.version}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStatus(acc.account_id, isActive ? "frozen" : "active");
                      }}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100"
                    >
                      {isActive ? "Freeze" : "Activate"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="5" className="px-5 py-6 text-center text-slate-400">
                  No matching accounts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
