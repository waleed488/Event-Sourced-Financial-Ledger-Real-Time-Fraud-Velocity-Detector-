// ============================================================================
// views/Overview.jsx
// The customer "home" screen: balance card, daily limit usage, quick actions,
// and the transaction history read from the immutable ledger_events log.
// ============================================================================

import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Send, Unlock } from "lucide-react";
import { api } from "../api.js";
import { describeEvent, formatMoney } from "../format.js";
import TransactionList from "../components/TransactionList.jsx";
import { Card, CardHeader, EmptyState, SegmentedControl } from "../components/ui.jsx";

function QuickAction({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-sm font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      {label}
    </button>
  );
}

function CardMeta({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-0.5 truncate text-sm text-white ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

export default function Overview({ account, dataVersion, navigate, onDataChanged, notify }) {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [toggling, setToggling] = useState(false);

  const accountId = account?.account_id;

  // Load the latest 100 ledger events for this account (served by the ESR index)
  useEffect(() => {
    if (!accountId) return;
    api
      .getAccountEvents(accountId, { limit: 100 })
      .then((data) => setEvents(data.events))
      .catch((err) => notify("error", "Could not load activity", err.message));
  }, [accountId, dataVersion, notify]);

  if (!account) {
    return <EmptyState title="No account selected" description="Pick an account in the top-right corner, or open a new one." />;
  }

  const isFrozen = account.status === "frozen";

  // Outgoing total over the last 24h — the same window the daily-limit fraud rule uses
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const spentLast24h = events
    .filter((e) => describeEvent(e).direction === "out" && new Date(e.timestamp).getTime() >= oneDayAgo)
    .reduce((sum, e) => sum + e.amount, 0);
  const limitUsedPercent = account.daily_limit > 0 ? Math.min(100, (spentLast24h / account.daily_limit) * 100) : 0;

  const visibleEvents = events.filter((e) => filter === "all" || describeEvent(e).direction === filter);

  async function toggleFreeze() {
    setToggling(true);
    try {
      await api.setAccountStatus(account.account_id, isFrozen ? "active" : "frozen");
      notify("success", isFrozen ? "Account unfrozen" : "Account frozen", isFrozen ? "Payments are enabled again." : "All outgoing payments will now be rejected.");
      onDataChanged();
    } catch (err) {
      notify("error", "Could not update account", err.message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Balance card — values come from the account_balances read model */}
        <div className="rounded-xl bg-slate-900 p-6 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Available balance</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight text-white tabular-nums">
                {formatMoney(account.current_balance, account.currency)}
              </div>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                isFrozen ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {isFrozen ? "Frozen" : "Active"}
            </span>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
            <CardMeta label="Account holder" value={account.holder_name} />
            <CardMeta label="Account number" value={account.account_id} mono />
            <CardMeta label="Ledger version" value={`v${account.version}`} mono />
          </div>
        </div>

        {/* Daily limit usage */}
        <Card className="p-6">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Daily spending limit</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">
            {formatMoney(spentLast24h)}
            <span className="text-sm font-normal text-slate-500"> of {formatMoney(account.daily_limit)}</span>
          </div>
          <div className="mt-4 h-1.5 rounded-full bg-slate-100">
            <div
              className={`h-1.5 rounded-full ${limitUsedPercent >= 100 ? "bg-rose-500" : "bg-emerald-500"}`}
              style={{ width: `${limitUsedPercent}%` }}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Outgoing payments in the last 24 hours. Going over the limit raises a fraud alert.
          </p>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction icon={Send} label="Send money" onClick={() => navigate("send")} disabled={isFrozen} />
        <QuickAction icon={ArrowDownToLine} label="Deposit" onClick={() => navigate("cash", { mode: "deposit" })} />
        <QuickAction icon={ArrowUpFromLine} label="Withdraw" onClick={() => navigate("cash", { mode: "withdraw" })} disabled={isFrozen} />
        <QuickAction
          icon={isFrozen ? Unlock : Lock}
          label={isFrozen ? "Unfreeze account" : "Freeze account"}
          onClick={toggleFreeze}
          disabled={toggling}
        />
      </div>

      {/* Transaction history */}
      <Card>
        <CardHeader
          title="Recent activity"
          description="Each line is an immutable event in ledger_events. Click a line to see its details."
          action={
            <SegmentedControl
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "in", label: "Money in" },
                { value: "out", label: "Money out" }
              ]}
            />
          }
        />
        <TransactionList events={visibleEvents.slice(0, 30)} />
      </Card>
    </div>
  );
}
