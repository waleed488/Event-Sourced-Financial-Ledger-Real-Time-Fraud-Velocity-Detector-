// ============================================================================
// components/ToastStack.jsx
// Top-right notifications: success messages, errors, and live fraud alerts.
// ============================================================================

import { CircleAlert, CircleCheck, ShieldAlert, X } from "lucide-react";

const TONES = {
  success: { icon: CircleCheck, color: "text-emerald-600" },
  error: { icon: CircleAlert, color: "text-rose-600" },
  alert: { icon: ShieldAlert, color: "text-rose-600" }
};

export default function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-96 flex-col gap-2">
      {toasts.map((toast) => {
        const tone = TONES[toast.tone] || TONES.success;
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex gap-3 rounded-lg border bg-white p-4 shadow-lg ${
              toast.tone === "alert" ? "border-rose-200" : "border-slate-200"
            }`}
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone.color}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{toast.title}</div>
              {toast.message && <div className="mt-0.5 text-sm text-slate-600">{toast.message}</div>}
            </div>
            <button onClick={() => onDismiss(toast.id)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
