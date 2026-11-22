// ============================================================================
// components/AccountPicker.jsx
// Searchable account dropdown. Searches the server as you type, so it works
// across all 2,000+ seeded accounts (not just the first page).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { api } from "../api.js";
import { formatMoney } from "../format.js";

export default function AccountPicker({ selected, onSelect, excludeId = null, placeholder = "Select an account" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  // Close the dropdown when the user clicks anywhere outside it
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search accounts on the server, waiting 250 ms after the last keystroke
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.listAccounts({ search: query.trim(), limit: 20 });
        setResults(data.accounts.filter((acc) => acc.account_id !== excludeId));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, excludeId]);

  function choose(account) {
    onSelect(account);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300"
      >
        {selected ? (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">{selected.holder_name}</div>
            <div className="truncate font-mono text-xs text-slate-500">{selected.account_id}</div>
          </div>
        ) : (
          <span className="py-2 text-sm text-slate-400">{placeholder}</span>
        )}
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-full min-w-[20rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or account number"
              className="w-full py-2.5 text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {loading && <li className="px-3 py-3 text-sm text-slate-400">Searching…</li>}
            {!loading && results.length === 0 && (
              <li className="px-3 py-3 text-sm text-slate-400">No accounts found</li>
            )}
            {!loading &&
              results.map((acc) => (
                <li key={acc.account_id}>
                  <button
                    type="button"
                    onClick={() => choose(acc)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-900">{acc.holder_name}</div>
                      <div className="font-mono text-xs text-slate-500">
                        {acc.account_id}
                        {acc.status === "frozen" && <span className="text-rose-600"> · frozen</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-slate-600">
                        {formatMoney(acc.current_balance, acc.currency)}
                      </span>
                      {selected?.account_id === acc.account_id && <Check className="h-4 w-4 text-emerald-600" />}
                    </div>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
