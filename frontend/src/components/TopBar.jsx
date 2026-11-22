// ============================================================================
// frontend/src/components/TopBar.jsx
// Institutional top bar + 4-metric KPI strip showing live replica set health,
// collection counts, and Change Stream worker state.
// ============================================================================

export default function TopBar({ status, sseConnected, onRefresh }) {
  const collections = status?.collections || {};
  const replicaNodes = status?.replica_set || [];
  const workerLive = Boolean(status?.fraud_worker?.running);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-4">
        {/* Title & Live Cluster Indicators */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 font-mono text-sm font-semibold text-white">
              FL
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                Event-Sourced Financial Ledger
              </h1>
              <p className="text-xs text-slate-500">
                MongoDB 3-Node Replica Set &middot; CQRS &middot; Real-Time Fraud Velocity Detector
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {replicaNodes.map((node) => (
              <span
                key={node.name}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    node.stateStr === "PRIMARY" ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
                {node.name.replace("localhost:", ":")} {node.stateStr}
              </span>
            ))}

            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
                sseConnected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  sseConnected ? "animate-pulse bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {sseConnected ? "SSE Stream Live" : "SSE Connecting"}
            </span>

            <button
              onClick={onRefresh}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Refresh Data
            </button>
          </div>
        </div>

        {/* 4-Card KPI Strip */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-xs font-medium text-slate-500">Total Accounts</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">
              {(collections.accounts ?? 0).toLocaleString()}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-xs font-medium text-slate-500">Immutable Ledger Events</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900">
              {(collections.ledger_events ?? 0).toLocaleString()}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-xs font-medium text-slate-500">Open Fraud Alerts</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-rose-600">
              {(collections.open_fraud_alerts ?? 0).toLocaleString()}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-xs font-medium text-slate-500">Change Stream Detector</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span
                className={`h-2 w-2 rounded-full ${workerLive ? "bg-emerald-500" : "bg-slate-400"}`}
              />
              {workerLive ? "Active & Watching" : "Offline"}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
