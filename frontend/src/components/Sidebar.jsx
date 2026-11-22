// ============================================================================
// components/Sidebar.jsx
// Left navigation. The order of the items is also the order of the demo:
// banking flows first, then the back-office screens.
// ============================================================================

import { ArrowLeftRight, Database, LayoutDashboard, Send, ShieldAlert, UserPlus } from "lucide-react";

const NAV_SECTIONS = [
  {
    title: "Banking",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "send", label: "Send money", icon: Send },
      { id: "cash", label: "Deposit & withdraw", icon: ArrowLeftRight },
      { id: "open", label: "Open account", icon: UserPlus }
    ]
  },
  {
    title: "Back office",
    items: [
      { id: "security", label: "Security center", icon: ShieldAlert },
      { id: "integrity", label: "Ledger integrity", icon: Database }
    ]
  }
];

function StatusLine({ ok, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      <span>{label}</span>
    </div>
  );
}

export default function Sidebar({ view, onNavigate, openAlerts, status, streamLive }) {
  const nodes = status?.replica_set || [];
  const healthyNodes = nodes.filter((node) => node.health === 1).length;

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-slate-950 text-slate-300">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500 text-sm font-bold text-slate-950">
          L
        </div>
        <div>
          <div className="text-sm font-semibold text-white">LedgerBank</div>
          <div className="text-[11px] text-slate-500">Core banking console</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = view === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => onNavigate(item.id)}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                        isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.id === "security" && openAlerts > 0 && (
                        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-rose-300">
                          {openAlerts > 999 ? "999+" : openAlerts}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Live infrastructure status */}
      <div className="space-y-1.5 border-t border-white/5 px-6 py-4 text-[11px] text-slate-400">
        <StatusLine
          ok={nodes.length > 0 && healthyNodes === nodes.length}
          label={`Replica set rs0 · ${healthyNodes}/${nodes.length || 3} nodes`}
        />
        <StatusLine ok={streamLive} label={streamLive ? "Fraud stream connected" : "Fraud stream offline"} />
      </div>
    </aside>
  );
}
