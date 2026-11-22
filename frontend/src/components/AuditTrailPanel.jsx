// ============================================================================
// frontend/src/components/AuditTrailPanel.jsx
// Displays the immutable ledger_events log for the selected account with
// type filtering powered by the ESR compound index.
// ============================================================================

import { formatMoney, formatTime } from "../api.js";

const TYPE_STYLES = {
  DEPOSIT: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  TRANSFER_IN: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  WITHDRAWAL: "bg-slate-100 text-slate-700 ring-slate-500/20",
  TRANSFER_OUT: "bg-amber-50 text-amber-800 ring-amber-600/20"
};

export default function AuditTrailPanel({
  selectedAccount,
  events,
  typeFilter,
  onChangeTypeFilter
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Immutable Ledger Audit Trail
          </h2>
          <p className="text-xs text-slate-500">
            Account:{" "}
            <span className="font-mono font-medium text-slate-700">
              {selectedAccount || "None selected"}
            </span>{" "}
            &middot; Queried via ESR index
          </p>
        </div>

        <select
          value={typeFilter}
          onChange={(e) => onChangeTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-500 focus:outline-none"
        >
          <option value="">All Event Types</option>
          <option value="TRANSFER_OUT">TRANSFER_OUT</option>
          <option value="TRANSFER_IN">TRANSFER_IN</option>
          <option value="DEPOSIT">DEPOSIT</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
        </select>
      </div>

      <div className="max-h-72 overflow-y-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-medium">Event Type</th>
              <th className="px-3 py-2.5 font-medium">Counterparty</th>
              <th className="px-3 py-2.5 font-medium">Location</th>
              <th className="px-3 py-2.5 text-right font-medium">Amount</th>
              <th className="px-5 py-2.5 text-right font-medium">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((ev) => {
              const isCredit = ev.type === "DEPOSIT" || ev.type === "TRANSFER_IN";
              return (
                <tr key={ev.event_id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 font-mono text-[11px] font-medium ring-1 ring-inset ${
                        TYPE_STYLES[ev.type] || "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {ev.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-600">
                    {ev.counterparty || "-"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">
                    {ev.geo_location?.city ? `${ev.geo_location.city}, ${ev.geo_location.country}` : "-"}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                      isCredit ? "text-emerald-600" : "text-slate-900"
                    }`}
                  >
                    {isCredit ? "+" : "-"}
                    {formatMoney(ev.amount, ev.currency)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono text-[11px] text-slate-500">
                    {formatTime(ev.timestamp)}
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && (
              <tr>
                <td colSpan="5" className="px-5 py-6 text-center text-slate-400">
                  No ledger events found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
