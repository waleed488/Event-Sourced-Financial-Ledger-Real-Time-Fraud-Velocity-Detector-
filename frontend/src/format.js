// ============================================================================
// format.js
// Display helpers: money (stored as integer minor units), dates, and
// human-readable labels for ledger events and fraud alerts.
// ============================================================================

// Simulated device locations (used by the impossible-travel fraud rule)
export const LOCATIONS = [
  { city: "Karachi", country: "PK", lat: 24.8607, lon: 67.0011 },
  { city: "Lahore", country: "PK", lat: 31.5204, lon: 74.3587 },
  { city: "Islamabad", country: "PK", lat: 33.6844, lon: 73.0479 },
  { city: "Dubai", country: "AE", lat: 25.2048, lon: 55.2708 },
  { city: "London", country: "UK", lat: 51.5074, lon: -0.1278 }
];

export function findLocation(city) {
  return LOCATIONS.find((loc) => loc.city === city) || LOCATIONS[0];
}

export const RULE_LABELS = {
  BURST_VELOCITY: "Burst velocity",
  SPENDING_SPIKE: "Spending spike",
  DAILY_LIMIT_BREACH: "Daily limit breach",
  IMPOSSIBLE_TRAVEL: "Impossible travel"
};

// 12550 -> "$125.50"
export function formatMoney(minorUnits, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(minorUnits || 0) / 100
  );
}

// "125.50" -> 12550 (returns null for empty, zero, or invalid input)
export function toMinorUnits(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

// Converts a raw ledger event into a bank-statement style line
export function describeEvent(event) {
  switch (event.type) {
    case "DEPOSIT":
      return { title: "Cash deposit", direction: "in" };
    case "WITHDRAWAL":
      return { title: "Cash withdrawal", direction: "out" };
    case "TRANSFER_IN":
      return { title: `Transfer from ${event.counterparty}`, direction: "in" };
    case "TRANSFER_OUT":
      return { title: `Transfer to ${event.counterparty}`, direction: "out" };
    default:
      return { title: event.type, direction: "out" };
  }
}

// One-line explanation of why an alert fired
export function describeAlert(alert) {
  const d = alert.details || {};
  switch (alert.rule_triggered) {
    case "BURST_VELOCITY":
      return `${alert.window_tx_count} outgoing payments within 2 minutes`;
    case "SPENDING_SPIKE":
      return d.rolling_avg
        ? `${formatMoney(d.event_amount ?? alert.window_total_amount)} against a ${formatMoney(d.rolling_avg)} average`
        : "Spending far above the recent average";
    case "DAILY_LIMIT_BREACH":
      return `${formatMoney(alert.window_total_amount)} sent in 24h (limit ${formatMoney(d.daily_limit)})`;
    case "IMPOSSIBLE_TRAVEL":
      return `${d.prev_city} to ${d.curr_city}, ${Number(d.distance_km || 0).toLocaleString()} km apart`;
    default:
      return "";
  }
}
