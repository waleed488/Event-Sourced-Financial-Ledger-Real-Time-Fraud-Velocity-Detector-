// ============================================================================
// frontend/src/components/FraudAlertsPanel.jsx
// Live SSE-driven fraud alert feed with detection latency metrics & resolution.
// ============================================================================

import { formatTime } from "../api.js";

function formatAlertDetails(alert) {
  const d = alert.details || {};
  if (alert.rule_triggered === "BURST_VELOCITY") {
    return `${alert.window_tx_count} outgoing transfers inside 2m`;
  }
  if (alert.rule_triggered === "SPENDING_SPIKE") {
    return `${d.multiplier || "3+"}x above rolling average`;
  }
  if (alert.rule_triggered === "DAILY_LIMIT_BREACH") {
    return `24h volume exceeded daily limit`;
  }
  if (alert.rule_triggered === "IMPOSSIBLE_TRAVEL") {
    return `${d.prev_city || "?"} → ${d.curr_city || "?"} (${d.distance_km ?? "?"} km)`;
  }
  return "";
}

export default function FraudAlertsPanel({
  alerts,
  statusFilter,
  onChangeStatusFilter,
  onResolveAlert
}) {
  const filtered = alerts.filter((a) =>
    statusFilter === "all" ? true : a.status === statusFilter
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Real-Time Fraud Alerts</h2>
          <p className="text-xs text-slate-500">
            Pushed via MongoDB Change Stream &rarr; SSE
          </p>
        </div>

        <select
          value={statusFilter}
          onChange={(e) => onChangeStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-500 focus:outline-none"
        >
          <option value="open">Open Only</option>
          <option value="all">All Alerts</option>
        </select>
      </div>

      <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
        {filtered.slice(0, 20).map((alert) => {
          const isHigh = alert.severity === "HIGH";
          return (
            <div key={alert.alert_id} className="px-5 py-3 transition hover:bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${
                      isHigh
                        ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20"
                        : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20"
                    }`}
                  >
                    {alert.severity}
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {alert.rule_triggered}
                  </span>
                </div>

                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-700">
                  {alert.detection_latency_ms} ms
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                <div className="text-slate-600">
                  <span className="font-mono font-medium text-slate-800">
                    {alert.account_id}
                  </span>{" "}
                  &middot; {formatAlertDetails(alert)}
                </div>

                {alert.status === "open" ? (
                  <button
                    onClick={() => onResolveAlert(alert.alert_id)}
                    className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Resolve
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] font-medium text-emerald-600">
                    Resolved
                  </span>
                )}
              </div>

              <div className="mt-1 font-mono text-[10px] text-slate-400">
                Detected {formatTime(alert.detected_at)}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-5 py-8 text-center text-xs text-slate-400">
            No fraud alerts matching this view.
          </div>
        )}
      </div>
    </section>
  );
}
