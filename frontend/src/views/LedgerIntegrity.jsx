// ============================================================================
// views/LedgerIntegrity.jsx
// Back-office screen: replica set health, collection sizes, and the CQRS
// maintenance operations (verify, rebuild, historical fraud scan).
// ============================================================================

import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { api } from "../api.js";
import { Badge, Button, Card, CardHeader, InlineAlert, StatTile } from "../components/ui.jsx";

function OperationRow({ title, description, buttonLabel, busy, disabled, onRun, result }) {
  return (
    <div className="px-6 py-5">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="text-sm font-medium text-slate-900">{title}</div>
          <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-slate-500">{description}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRun} disabled={disabled}>
          {busy ? "Running…" : buttonLabel}
        </Button>
      </div>
      {result && <div className="mt-3">{result}</div>}
    </div>
  );
}

export default function LedgerIntegrity({ dataVersion, onDataChanged, notify }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [rebuildResult, setRebuildResult] = useState(null);
  const [backfillResult, setBackfillResult] = useState(null);

  useEffect(() => {
    api
      .getStatus()
      .then(setStatus)
      .catch((err) => notify("error", "Could not load cluster status", err.message));
  }, [dataVersion, notify]);

  // Runs one back-office operation and stores its result
  async function runOperation(name, operation, saveResult) {
    setBusy(name);
    try {
      saveResult(await operation());
      onDataChanged();
    } catch (err) {
      notify("error", "Operation failed", err.message);
    } finally {
      setBusy(null);
    }
  }

  const counts = status?.collections || {};
  const nodes = status?.replica_set || [];
  const workerRunning = Boolean(status?.fraud_worker?.running);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Accounts" value={(counts.accounts ?? 0).toLocaleString()} />
        <StatTile label="Ledger events" value={(counts.ledger_events ?? 0).toLocaleString()} />
        <StatTile label="Open fraud alerts" value={(counts.open_fraud_alerts ?? 0).toLocaleString()} valueClass="text-rose-600" />
        <StatTile
          label="Fraud detector"
          value={workerRunning ? "Running" : "Stopped"}
          valueClass={workerRunning ? "text-emerald-600" : "text-slate-500"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Replica set members */}
        <Card className="h-fit">
          <CardHeader title="Replica set rs0" description="Writes use majority concern, so 2 of 3 nodes must acknowledge." />
          <ul className="divide-y divide-slate-100">
            {nodes.map((node) => (
              <li key={node.name} className="flex items-center justify-between px-6 py-3.5">
                <div className="flex items-center gap-3">
                  <Server className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
                  <span className="font-mono text-sm text-slate-800">{node.name}</span>
                </div>
                <Badge tone={node.stateStr === "PRIMARY" ? "success" : "neutral"}>{node.stateStr}</Badge>
              </li>
            ))}
            {nodes.length === 0 && <li className="px-6 py-6 text-sm text-slate-500">Replica set status unavailable.</li>}
          </ul>
        </Card>

        {/* CQRS maintenance */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Read model maintenance"
            description="ledger_events is the source of truth. account_balances is a fast copy derived from it."
          />
          <div className="divide-y divide-slate-100">
            <OperationRow
              title="Verify balances"
              description="Recomputes every balance from ledger_events and compares it with account_balances. Read-only."
              buttonLabel="Verify"
              busy={busy === "verify"}
              disabled={busy !== null}
              onRun={() => runOperation("verify", api.verifyBalances, setVerifyResult)}
              result={
                verifyResult && (
                  <InlineAlert tone={verifyResult.exact_match ? "success" : "danger"}>
                    {verifyResult.matched.toLocaleString()} of {verifyResult.total_accounts.toLocaleString()} accounts match
                    the ledger exactly · {verifyResult.mismatched} mismatched
                  </InlineAlert>
                )
              }
            />

            <OperationRow
              title="Rebuild balances from the ledger"
              description="Replaces account_balances using $group + $merge over the full event log. Meant for offline recovery, because live writes during the rebuild can drift briefly."
              buttonLabel="Rebuild"
              busy={busy === "rebuild"}
              disabled={busy !== null}
              onRun={() => runOperation("rebuild", api.rebuildBalances, setRebuildResult)}
              result={
                rebuildResult && (
                  <InlineAlert tone="success">
                    Rebuilt {rebuildResult.rebuilt_accounts.toLocaleString()} account balances in{" "}
                    {rebuildResult.duration_ms.toLocaleString()} ms.
                  </InlineAlert>
                )
              }
            />

            <OperationRow
              title="Historical fraud scan"
              description="Runs $setWindowFields over all outgoing events to find bursts and spending spikes in past data."
              buttonLabel="Run scan"
              busy={busy === "backfill"}
              disabled={busy !== null}
              onRun={() => runOperation("backfill", api.backfillFraud, setBackfillResult)}
              result={
                backfillResult && (
                  <InlineAlert tone="success">
                    Scanned {backfillResult.flagged_events_scanned.toLocaleString()} flagged events and added{" "}
                    {backfillResult.new_alerts_inserted.toLocaleString()} new alerts in{" "}
                    {backfillResult.duration_ms.toLocaleString()} ms.
                  </InlineAlert>
                )
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
