// ============================================================================
// App.jsx
// Application shell: sidebar navigation, header with the active-account
// switcher, live fraud alerts over Server-Sent Events, and toast messages.
//
// Data flow: any screen that changes data calls refresh(), which bumps
// dataVersion. Every screen re-fetches what it shows when dataVersion changes.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import AccountPicker from "./components/AccountPicker.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ToastStack from "./components/ToastStack.jsx";
import { RULE_LABELS, describeAlert } from "./format.js";
import DepositWithdraw from "./views/DepositWithdraw.jsx";
import LedgerIntegrity from "./views/LedgerIntegrity.jsx";
import OpenAccount from "./views/OpenAccount.jsx";
import Overview from "./views/Overview.jsx";
import SecurityCenter from "./views/SecurityCenter.jsx";
import SendMoney from "./views/SendMoney.jsx";

const VIEW_TITLES = {
  overview: { title: "Overview", description: "Balance and recent activity for the active account" },
  send: { title: "Send money", description: "Transfer funds to another account" },
  cash: { title: "Deposit & withdraw", description: "Move cash into or out of the active account" },
  open: { title: "Open account", description: "Create a new customer account" },
  security: { title: "Security center", description: "Real-time fraud detection and alert review" },
  integrity: { title: "Ledger integrity", description: "Cluster health and read model verification" }
};

export default function App() {
  const [view, setView] = useState("overview");
  const [viewParams, setViewParams] = useState(null);
  const [activeAccountId, setActiveAccountId] = useState(() => localStorage.getItem("activeAccountId") || "");
  const [activeAccount, setActiveAccount] = useState(null);
  const [status, setStatus] = useState(null);
  const [streamLive, setStreamLive] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState([]);

  const refresh = useCallback(() => setDataVersion((v) => v + 1), []);

  // Show a toast that disappears on its own after 6 seconds
  const notify = useCallback((tone, title, message) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, tone, title, message }].slice(-4));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  // First visit: choose a funded, active account automatically
  useEffect(() => {
    if (activeAccountId) return;
    api
      .listAccounts({ limit: 20 })
      .then((data) => {
        const first = data.accounts.find((a) => a.status === "active" && a.current_balance > 0) || data.accounts[0];
        if (first) setActiveAccountId(first.account_id);
      })
      .catch((err) => notify("error", "Cannot reach the API", err.message));
  }, [activeAccountId, notify]);

  
  useEffect(() => {
    if (!activeAccountId) return;
    localStorage.setItem("activeAccountId", activeAccountId);
    api
      .getAccount(activeAccountId)
      .then(setActiveAccount)
      .catch((err) => {
        if (err.status === 404) {
          localStorage.removeItem("activeAccountId");
          setActiveAccount(null);
          setActiveAccountId("");
        }
      });
  }, [activeAccountId, dataVersion]);

  // Cluster status and open-alert count for the sidebar
  useEffect(() => {
    api.getStatus().then(setStatus).catch(() => setStatus(null));
  }, [dataVersion]);

  // Live fraud alerts pushed from the change-stream worker over SSE
  useEffect(() => {
    const source = new EventSource("/api/alerts/stream");
    source.addEventListener("connected", () => setStreamLive(true));
    source.addEventListener("alert", (event) => {
      const alert = JSON.parse(event.data);
      notify(
        "alert",
        `${RULE_LABELS[alert.rule_triggered] || alert.rule_triggered} detected`,
        `${alert.account_id} · ${describeAlert(alert)} · flagged in ${alert.detection_latency_ms} ms`
      );
      refresh();
    });
    source.onerror = () => setStreamLive(false);
    return () => source.close();
  }, [notify, refresh]);

  function navigate(nextView, params = null) {
    setView(nextView);
    setViewParams(params);
  }

  function handleAccountOpened(accountId) {
    setActiveAccountId(accountId);
    refresh();
    navigate("overview");
  }

  // Props shared by most screens
  const shared = { account: activeAccount, dataVersion, onDataChanged: refresh, notify, navigate };
  const openAlerts = status?.collections?.open_fraud_alerts ?? 0;

  let content = null;
  if (view === "overview") content = <Overview {...shared} />;
  if (view === "send") content = <SendMoney {...shared} />;
  if (view === "cash") content = <DepositWithdraw {...shared} params={viewParams} />;
  if (view === "open") content = <OpenAccount notify={notify} onAccountOpened={handleAccountOpened} />;
  if (view === "security") content = <SecurityCenter {...shared} openAlerts={openAlerts} />;
  if (view === "integrity") content = <LedgerIntegrity {...shared} />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar view={view} onNavigate={navigate} openAlerts={openAlerts} status={status} streamLive={streamLive} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-6 border-b border-slate-200 bg-white px-8 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{VIEW_TITLES[view].title}</h1>
            <p className="text-sm text-slate-500">{VIEW_TITLES[view].description}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Active account</span>
            <div className="w-64">
              <AccountPicker selected={activeAccount} onSelect={(acc) => setActiveAccountId(acc.account_id)} />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-8 py-8">{content}</div>
        </main>
      </div>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}
