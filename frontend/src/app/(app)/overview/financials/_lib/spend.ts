/**
 * Pure display rules for the Costs page. Kept apart from the components so
 * the two promises this page makes are testable without rendering:
 *
 * - **Unknown is not zero.** A vendor whose figure the server could not
 *   establish contributes nothing to a sum, and the sum then says it is a
 *   floor ("at least $X (GitHub not available)") rather than a total.
 * - **A missing day is a gap, not a $0 day.** The daily series keeps a day
 *   with no reported row as `null`, which the chart draws as no bar.
 *
 * Nothing here estimates. The only arithmetic is adding the provider-reported
 * figures the server sent, so the page can show them side by side.
 */

import { formatMicros } from "@/components/overview/money";
import type {
  SpendAlert,
  SpendSeriesRow,
  SpendVendor,
  SpendView,
  VendorStatus,
} from "./spend-api";

const MICROS_PER_UNIT = 1_000_000;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every UTC day from `from` through `to`, inclusive. Empty when either is
 *  unreadable or `to` precedes `from`. */
export function daysBetween(from: string, to: string): string[] {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end || end < start) return [];
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    days.push(toDay(new Date(t)));
  }
  return days;
}

/** `2026-10-02` → `Oct 2, 2026` (UTC — billing days are UTC days). */
export function formatDay(day: string | null | undefined): string | null {
  if (!day) return null;
  const date = parseDay(day.slice(0, 10));
  if (!date) return day;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `2026-10-02` → `Oct 2` for an axis tick. */
export function formatShortDay(day: string): string {
  const date = parseDay(day);
  if (!date) return day;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** An ISO instant as the reader sees a fetch time: `Oct 3, 06:10 UTC`. */
export function formatFetched(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${day}, ${time} UTC`;
}

// ---------------------------------------------------------------------------
// Vendor status
// ---------------------------------------------------------------------------

export type StatusTone = "good" | "warning" | "critical" | "neutral";

export const STATUS_LABEL: Record<
  VendorStatus,
  { label: string; tone: StatusTone }
> = {
  ok: { label: "Up to date", tone: "good" },
  stale: { label: "Behind", tone: "warning" },
  failed: { label: "Last fetch failed", tone: "critical" },
  never: { label: "Never fetched", tone: "warning" },
  not_linked: { label: "Not linked", tone: "neutral" },
  manual: { label: "Entered manually", tone: "neutral" },
};

/** The status a reader sees for any value the server sends, including one
 *  this build does not know yet — shown as itself, never as "ok". */
export function statusLabel(status: string): {
  label: string;
  tone: StatusTone;
} {
  return (
    STATUS_LABEL[status as VendorStatus] ?? { label: status, tone: "warning" }
  );
}

/** True when this vendor's figures cannot be relied on right now. */
export function isVendorUnknown(vendor: SpendVendor): boolean {
  return (
    vendor.status === "stale" ||
    vendor.status === "failed" ||
    vendor.status === "never"
  );
}

/**
 * The sentence an UNKNOWN vendor shows in place of a figure:
 * "Not available since Oct 1, 2026 — <reason>". The date is the newest day
 * the provider's figures are complete for (else the last good fetch); a
 * vendor never fetched has no such date and says so.
 */
export function unavailableSentence(vendor: SpendVendor): string {
  const since =
    formatDay(vendor.newest_complete_day) ??
    formatDay(vendor.last_ok_at?.slice(0, 10));
  const reason =
    vendor.status_reason?.trim() ||
    (vendor.status === "never"
      ? "nothing has been fetched from this provider yet"
      : vendor.status === "not_linked"
        ? "this provider's account is not linked"
        : vendor.status === "failed"
          ? "the last fetch failed"
          : "the provider's figures are behind");
  return since
    ? `Not available since ${since} — ${reason}`
    : `Not available — ${reason}`;
}

// ---------------------------------------------------------------------------
// Figures added across vendors
// ---------------------------------------------------------------------------

export type VendorFigure =
  | "month_to_date_micros"
  | "today_micros"
  | "yesterday_micros"
  | "last_month_micros";

export interface CombinedFigure {
  /** The sum of the figures that ARE known; `null` when none is. */
  knownMicros: number | null;
  /** Vendors whose figure is in the sum, in the order given. */
  reported: SpendVendor[];
  /** Vendors whose figure is not available — the sum is a floor. */
  missing: SpendVendor[];
  /** Vendors in the sum whose figures are behind or failed, so their part
   *  may be short — the sum is a floor for them too. */
  incomplete: SpendVendor[];
}

/**
 * Add one figure across vendors. A vendor whose figure is `null` is MISSING
 * and adds nothing — it is never counted as 0. A vendor that is stale,
 * failed or never fetched but did send a figure is added, and marked
 * INCOMPLETE: what it reported is real, but it may not be all of it.
 */
export function combineFigure(
  vendors: readonly SpendVendor[],
  figure: VendorFigure
): CombinedFigure {
  const reported: SpendVendor[] = [];
  const missing: SpendVendor[] = [];
  const incomplete: SpendVendor[] = [];
  let known: number | null = null;
  for (const vendor of vendors) {
    const value = vendor[figure];
    if (value === null || value === undefined) {
      missing.push(vendor);
      continue;
    }
    reported.push(vendor);
    if (isVendorUnknown(vendor)) incomplete.push(vendor);
    known = (known ?? 0) + value;
  }
  return { knownMicros: known, reported, missing, incomplete };
}

/** "GitHub", "GitHub and AWS", "GitHub, AWS and Vercel". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The words for a combined figure. A complete total is just the amount; one
 * over a missing or incomplete vendor is a floor that names who; one with
 * nothing known is `null`, for the caller to render as "not available".
 */
export function combinedText(
  combined: CombinedFigure,
  currency: string
): { text: string | null; partial: boolean } {
  const partial = combined.missing.length > 0 || combined.incomplete.length > 0;
  const amount = formatMicros(combined.knownMicros, currency, {
    maximumFractionDigits: 2,
  });
  if (amount === null) return { text: null, partial };
  if (!partial) return { text: amount, partial: false };
  const notes: string[] = [];
  if (combined.missing.length > 0)
    notes.push(
      `${joinNames(combined.missing.map((v) => v.name))} not available`
    );
  if (combined.incomplete.length > 0)
    notes.push(
      `${joinNames(combined.incomplete.map((v) => v.name))} may be incomplete`
    );
  return { text: `at least ${amount} (${notes.join("; ")})`, partial: true };
}

/** Where a combined figure came from, as a provenance line. */
export function provenanceLine(combined: CombinedFigure): string | null {
  if (combined.reported.length === 0) return null;
  return combined.reported
    .map((v) =>
      v.provenance
        ? `${v.name}: ${v.provenance}`
        : v.connector === null
          ? `${v.name}: entered manually — from the provider's invoice`
          : v.name
    )
    .join(" · ");
}

/** The label every monthly figure carries for the view it is in. */
export function viewLabel(view: SpendView): string {
  return view === "amortized"
    ? "Yearly costs amortized monthly"
    : "Yearly costs charged on renewal";
}

// ---------------------------------------------------------------------------
// The month-to-date meter
// ---------------------------------------------------------------------------

export type MeterTone = "normal" | "warning" | "over";

/**
 * The meter's colour. It turns warning-coloured once a month-to-date
 * threshold alert has fired for this vendor this month (the thresholds are
 * the tenant's own rule, so the alert is the only honest signal that one was
 * crossed), and "over" at or past the ceiling.
 */
export function meterTone(
  vendor: SpendVendor,
  alerts: readonly SpendAlert[],
  month: string
): MeterTone {
  if (vendor.ceiling_pct !== null && vendor.ceiling_pct >= 100) return "over";
  const crossed = alerts.some(
    (a) =>
      a.rule === "mtd_threshold" &&
      a.vendor_id === vendor.id &&
      a.period_key === month
  );
  return crossed ? "warning" : "normal";
}

// ---------------------------------------------------------------------------
// The daily bars
// ---------------------------------------------------------------------------

/** One day of the stacked chart. Each vendor's slot holds its amount in
 *  currency units, or `null` when nothing was reported for that day — a gap,
 *  never a zero. */
export interface DailyBar {
  day: string;
  /** vendor id → amount in units, or null for no data. */
  values: Record<string, number | null>;
  /** Whether ANY vendor reported for this day. */
  hasData: boolean;
}

/**
 * One entry per day in [from, to]. A vendor's amount for a day is the sum of
 * its rows for that day (a connector row and a recurring row can share a
 * day); a day with no row for a vendor stays `null`.
 */
export function dailyBars(
  series: readonly SpendSeriesRow[],
  vendors: readonly SpendVendor[],
  from: string,
  to: string
): DailyBar[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const row of series) {
    if (row.net_micros === null || row.net_micros === undefined) continue;
    let day = byDay.get(row.key);
    if (!day) {
      day = new Map();
      byDay.set(row.key, day);
    }
    day.set(row.vendor_id, (day.get(row.vendor_id) ?? 0) + row.net_micros);
  }
  return daysBetween(from, to).map((day) => {
    const reported = byDay.get(day);
    const values: Record<string, number | null> = {};
    for (const vendor of vendors) {
      const micros = reported?.get(vendor.id);
      values[vendor.id] =
        micros === undefined ? null : micros / MICROS_PER_UNIT;
    }
    return {
      day,
      values,
      hasData: reported !== undefined && reported.size > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// The breakdown table
// ---------------------------------------------------------------------------

export interface BreakdownRow {
  vendorId: string;
  key: string;
  gross: number | null;
  discount: number | null;
  net: number | null;
  /** Some of this row's lines did not report a net amount. */
  incomplete: boolean;
  sources: SpendSeriesRow["source"][];
}

function addKnown(a: number | null, b: number | null | undefined) {
  if (b === null || b === undefined) return a;
  return (a ?? 0) + b;
}

/**
 * Rows of a `group_by=scope|sku` read, one per (vendor, key). Gross and
 * discount are kept apart from net and stay `null` where the provider does
 * not report them. Largest net first; a row with no net sorts last.
 */
export function breakdownRows(
  series: readonly SpendSeriesRow[]
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const line of series) {
    const id = `${line.vendor_id}\u0000${line.key}`;
    const row = rows.get(id) ?? {
      vendorId: line.vendor_id,
      key: line.key,
      gross: null,
      discount: null,
      net: null,
      incomplete: false,
      sources: [],
    };
    row.gross = addKnown(row.gross, line.gross_micros);
    row.discount = addKnown(row.discount, line.discount_micros);
    row.net = addKnown(row.net, line.net_micros);
    if (line.net_micros === null || line.net_micros === undefined)
      row.incomplete = true;
    if (!row.sources.includes(line.source)) row.sources.push(line.source);
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => {
    if (a.net === null && b.net === null) return a.key.localeCompare(b.key);
    if (a.net === null) return 1;
    if (b.net === null) return -1;
    return b.net - a.net;
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

const RULE_LABEL: Record<string, string> = {
  mtd_threshold: "Month to date crossed a threshold",
  daily_abs: "A day's spend went over the daily limit",
  spike: "Spend spike",
  stale: "Collector stale",
  scheduled_renewal: "Scheduled renewal charged",
};

export function ruleLabel(rule: string): string {
  return RULE_LABEL[rule] ?? rule;
}

const PUSH_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Not sent yet", tone: "neutral" },
  accepted: { label: "Accepted by the push service", tone: "neutral" },
  delivered: { label: "Delivered to the phone", tone: "good" },
  failed: { label: "Push failed", tone: "critical" },
  unknown_recipients: {
    label: "Recipients could not be read — will retry",
    tone: "warning",
  },
  muted: { label: "Muted", tone: "neutral" },
};

/** The push delivery as observed — "accepted" is not "delivered". */
export function pushLabel(status: string): { label: string; tone: StatusTone } {
  return PUSH_LABEL[status] ?? { label: status, tone: "warning" };
}

const COORD_LABEL: Record<string, string> = {
  pending: "not yet handed to agents",
  sent: "handed to agents",
  failed: "hand-off to agents failed — will retry",
  unsupported: "agent hand-off not available",
  disabled: "agent hand-off switched off",
};

/** The coord (agent work) delivery as observed. */
export function coordLabel(status: string): string {
  return COORD_LABEL[status] ?? status;
}

/** The first day of `day`'s month as `YYYY-MM`. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}
