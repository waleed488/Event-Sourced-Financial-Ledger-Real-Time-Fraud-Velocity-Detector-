// ============================================================================
// api.js
// Every backend call used by the UI lives here, so screens never build URLs.
// ============================================================================

async function request(path, { method = "GET", body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data?.error?.message || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

// Every money movement gets a unique Idempotency-Key so retries never double-post
export function newIdempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export const api = {
  // --- Accounts ---
  listAccounts: ({ search = "", limit = 20 } = {}) =>
    request(`/api/accounts?limit=${limit}&search=${encodeURIComponent(search)}`),
  getAccount: (accountId) => request(`/api/accounts/${encodeURIComponent(accountId)}`),
  createAccount: (payload) => request("/api/accounts", { method: "POST", body: payload }),
  setAccountStatus: (accountId, status) =>
    request(`/api/accounts/${encodeURIComponent(accountId)}/status`, {
      method: "PATCH",
      body: { status }
    }),
  getAccountEvents: (accountId, { type = "", limit = 50 } = {}) =>
    request(
      `/api/accounts/${encodeURIComponent(accountId)}/events?limit=${limit}&type=${encodeURIComponent(type)}`
    ),

  // --- Money movement ---
  deposit: (payload, key) =>
    request("/api/transactions/deposits", {
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": key }
    }),
  withdraw: (payload, key) =>
    request("/api/transactions/withdrawals", {
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": key }
    }),
  transfer: (payload, key) =>
    request("/api/transactions/transfers", {
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": key }
    }),

  // --- Fraud alerts ---
  listAlerts: ({ status, accountId, limit = 50 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("status", status);
    if (accountId) params.set("accountId", accountId);
    return request(`/api/alerts?${params.toString()}`);
  },
  resolveAlert: (alertId) => request(`/api/alerts/${alertId}/resolve`, { method: "PATCH" }),

  // --- Back office ---
  getStatus: () => request("/api/admin/status"),
  verifyBalances: () => request("/api/admin/verify-balances", { method: "POST" }),
  rebuildBalances: () => request("/api/admin/rebuild-balances", { method: "POST" }),
  backfillFraud: () => request("/api/admin/backfill-fraud", { method: "POST", body: {} })
};
