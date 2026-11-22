// ============================================================================
// components/ui.jsx
// Small shared building blocks (card, button, badge, form field...) so every
// screen looks consistent without repeating long Tailwind class strings.
// ============================================================================

export function Card({ className = "", children }) {
  return <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function CardHeader({ title, description, action }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 shadow-sm",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm"
};

const BUTTON_SIZES = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm"
};

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-slate-700">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-700/10";

const BADGE_TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-500/10",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  danger: "bg-rose-50 text-rose-700 ring-rose-600/20"
};

export function Badge({ tone = "neutral", children }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === option.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function InlineAlert({ tone = "danger", children }) {
  const styles =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return <div className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`}>{children}</div>;
}

export function StatTile({ label, value, valueClass = "text-slate-900" }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </Card>
  );
}

export function EmptyState({ title, description }) {
  return (
    <Card className="px-6 py-16 text-center">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </Card>
  );
}
