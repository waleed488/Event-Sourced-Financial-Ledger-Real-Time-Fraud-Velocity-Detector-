// ============================================================================
// components/TransactionList.jsx
// Bank-statement style list of ledger events. Clicking a row reveals the raw
// event-sourcing fields (event ID, transaction ID, idempotency key).
// ============================================================================

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown } from "lucide-react";
import { describeEvent, formatDateTime, formatMoney } from "../format.js";

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-mono text-slate-800" title={value}>
        {value}
      </dd>
    </div>
  );
}

export default function TransactionList({ events }) {
  const [expandedId, setExpandedId] = useState(null);

  if (events.length === 0) {
    return <div className="px-6 py-12 text-center text-sm text-slate-500">No transactions to show.</div>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {events.map((event) => {
        const { title, direction } = describeEvent(event);
        const isIncoming = direction === "in";
        const isExpanded = expandedId === event.event_id;

        return (
          <li key={event.event_id}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : event.event_id)}
              className="flex w-full items-center gap-4 px-6 py-3.5 text-left transition hover:bg-slate-50"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  isIncoming ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-600"
                }`}
              >
                {isIncoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{title}</div>
                <div className="text-xs text-slate-500">
                  {formatDateTime(event.timestamp)}
                  {event.geo_location?.city ? ` · ${event.geo_location.city}` : ""}
                </div>
              </div>

              <div className={`text-sm font-semibold tabular-nums ${isIncoming ? "text-emerald-600" : "text-slate-900"}`}>
                {isIncoming ? "+" : "−"}
                {formatMoney(event.amount, event.currency)}
              </div>

              <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isExpanded ? "rotate-180" : ""}`} />
            </button>

            {isExpanded && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 bg-slate-50 py-4 pl-[4.75rem] pr-6 text-xs">
                <Detail label="Event type" value={event.type} />
                <Detail label="Transaction ID" value={event.transaction_id} />
                <Detail label="Event ID" value={event.event_id} />
                <Detail label="Idempotency key" value={event.idempotency_key} />
                <Detail label="Recorded at (UTC)" value={new Date(event.timestamp).toISOString()} />
                <Detail label="Counterparty" value={event.counterparty || "—"} />
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}
