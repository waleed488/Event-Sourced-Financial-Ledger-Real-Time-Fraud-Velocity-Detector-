// ============================================================================
// views/SecurityCenter.jsx
// Fraud alerts raised by the change-stream detector (live) and by the
// $setWindowFields historical scan (backfill), plus one-click attack
// simulations that send real transfers from the active account.
// ============================================================================

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api, newIdempotencyKey } from "../api.js";
import { RULE_LABELS, describeAlert, findLocation, formatDateTime } from "../format.js";
import AccountPicker from "../components/AccountPicker.jsx";
import { Badge, Button, Card, CardHeader, Field, SegmentedControl, StatTile } from "../components/ui.jsx";

function AlertRow({ alert, onResolve }) {
  const isBackfill = alert.details?.source === "window_backfill";
  const isHigh = alert.severity === "HIGH";

  return (
    <li className="flex items-start gap-4 px-6 py-4">
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isHigh ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"
        }`}
      >
        <ShieldAlert className="h-4 w-4" strokeWidth={1.75} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{RULE_LABELS[alert.rule_triggered] || alert.rule_triggered}</span>
          <Badge tone={isHigh ? "danger" : "warning"}>{isHigh ? "High" : "Medium"}</Badge>
          {isBackfill && <Badge>Historical scan</Badge>}
        </div>
        <div className="mt-0.5 text-sm text-slate-600">{describeAlert(alert)}</div>
        <div className="mt-1 text-xs text-slate-500">
          <span className="font-mono">{alert.account_id}</span> · {formatDateTime(alert.detected_at)} ·{" "}
          {isBackfill ? "found by $setWindowFields" : `detected in ${alert.detection_latency_ms} ms`}
        </div>
      </div>

      {alert.status === "open" ? (
        <Button variant="secondary" size="sm" onClick={() => onResolve(alert.alert_id)}>
          Resolve
        </Button>
      ) : (
        <span className="text-xs font-medium text-emerald-600">Resolved</span>
      )}
    </li>
  );
}

export default function SecurityCenter({ account, openAlerts, dataVersion, onDataChanged, notify }) {
  const [alerts, setAlerts] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [scope, setScope] = useState("account");
  const [recipient, setRecipient] = useState(null);
  const [running, setRunning] = useState(null);

  const accountId = account?.account_id;

  // Load alerts for the chosen filters (re-runs whenever a new alert arrives)
  useEffect(() => {
    api
      .listAlerts({
        status: statusFilter === "all" ? undefined : statusFilter,
        accountId: scope === "account" ? accountId : undefined,
        limit: 50
      })
      .then((data) => setAlerts(data.alerts))
      .catch((err) => notify("error", "Could not load alerts", err.message));
  }, [statusFilter, scope, accountId, dataVersion, notify]);

  // Pre-select a recipient so each simulation is a single click
  useEffect(() => {
    if (!accountId) return;
    api
      .listAccounts({ limit: 10 })
      .then((data) => setRecipient(data.accounts.find((a) => a.account_id !== accountId && a.status === "active") || null))
      .catch(() => {});
  }, [accountId]);

  // Summary numbers for the tiles
  const liveAlerts = alerts.filter((a) => a.details?.source !== "window_backfill");
  const averageLatency = liveAlerts.length
    ? Math.round(liveAlerts.reduce((sum, a) => sum + a.detection_latency_ms, 0) / liveAlerts.length)
    : null;
  const highCount = alerts.filter((a) => a.severity === "HIGH").length;

  // Sends one real transfer from the active account to the chosen recipient
  function sendTransfer(amountMinor, city) {
    return api.transfer(
      {
        fromAccountId: accountId,
        toAccountId: recipient.account_id,
        amount: amountMinor,
        geoLocation: findLocation(city)
      },
      newIdempotencyKey("SIM")
    );
  }

  // Picks a spike amount of 4x the account's recent average outgoing payment
  async function computeSpikeAmount() {
    const data = await api.getAccountEvents(accountId, { limit: 50 });
    const outgoing = data.events.filter((e) => e.type === "TRANSFER_OUT" || e.type === "WITHDRAWAL").slice(0, 20);
    const average = outgoing.length ? outgoing.reduce((sum, e) => sum + e.amount, 0) / outgoing.length : 1000;
    return Math.max(Math.round(average * 4), 5000);
  }

  const scenarios = [
    {
      id: "burst",
      title: "Burst velocity",
      description: "Six $10.00 transfers back to back. The rule fires at 6 payments within 2 minutes.",
      run: async () => {
        for (let i = 0; i < 6; i++) await sendTransfer(1000, "Karachi");
      }
    },
    {
      id: "spike",
      title: "Spending spike",
      description: "One transfer at 4x the recent average. Needs at least 5 earlier payments, so run Burst first.",
      run: async () => {
        await sendTransfer(await computeSpikeAmount(), "Karachi");
      }
    },
    {
      id: "travel",
      title: "Impossible travel",
      description: "A payment from Karachi, then one from London seconds later (about 6,300 km).",
      run: async () => {
        await sendTransfer(1500, "Karachi");
        await sendTransfer(1500, "London");
      }
    }
  ];

  async function runScenario(scenario) {
    if (!accountId || !recipient) {
      notify("error", "Cannot run simulation", "Select an active account and a recipient first.");
      return;
    }
    setRunning(scenario.id);
    try {
      await scenario.run();
      notify("success", `${scenario.title} simulated`, "Transfers committed. The alert appears as soon as the detector flags it.");
      onDataChanged();
    } catch (err) {
      notify("error", "Simulation failed", err.message);
    } finally {
      setRunning(null);
    }
  }

  async function resolveAlert(alertId) {
    try {
      await api.resolveAlert(alertId);
      onDataChanged();
    } catch (err) {
      notify("error", "Could not resolve alert", err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open alerts (all accounts)" value={openAlerts.toLocaleString()} valueClass="text-rose-600" />
        <StatTile label="High severity in this list" value={highCount} />
        <StatTile label="Average live detection time" value={averageLatency === null ? "—" : `${averageLatency} ms`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Alert list */}
        <Card className="lg:col-span-2">
          <CardHeader title="Fraud alerts" description="Raised by the change-stream detector within milliseconds of a commit." />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3">
            <SegmentedControl
              value={scope}
              onChange={setScope}
              options={[
                { value: "account", label: "This account" },
                { value: "all", label: "All accounts" }
              ]}
            />
            <SegmentedControl
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "open", label: "Open" },
                { value: "resolved", label: "Resolved" },
                { value: "all", label: "All" }
              ]}
            />
          </div>

          {alerts.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">No alerts for this view.</div>
          ) : (
            <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto">
              {alerts.map((alert) => (
                <AlertRow key={alert.alert_id} alert={alert} onResolve={resolveAlert} />
              ))}
            </ul>
          )}
        </Card>

        {/* Attack simulations */}
        <Card className="h-fit">
          <CardHeader title="Simulate suspicious activity" description="Sends real transfers from the active account." />
          <div className="space-y-4 p-6">
            <Field label="Recipient">
              <AccountPicker selected={recipient} onSelect={setRecipient} excludeId={accountId} placeholder="Choose a recipient" />
            </Field>

            {scenarios.map((scenario) => (
              <div key={scenario.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{scenario.title}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{scenario.description}</p>
                  </div>
                  <Button size="sm" onClick={() => runScenario(scenario)} disabled={running !== null}>
                    {running === scenario.id ? "Running…" : "Run"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
