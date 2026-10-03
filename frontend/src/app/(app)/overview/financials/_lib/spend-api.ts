/**
 * The spend read contract, client side (plan
 * `2026-10-03-provider-reported-spend-collection-alerts-and-mobile`, Phase 1
 * and Phase 4).
 *
 * Every amount is the PROVIDER'S own statement (or an invoice amount the
 * operator entered as a recurring cost), carried as integer micros beside its
 * currency. A figure the server could not establish is `null` — never 0 — and
 * this module never turns one into the other.
 */

import { httpClient } from "@/services/service-factory";

const SPEND_API = "/api/v1/overview/spend";

/** Why a vendor's figures can or cannot be trusted right now. */
export type VendorStatus =
  | "ok"
  | "stale"
  | "failed"
  | "never"
  | "not_linked"
  | "manual";

/** How yearly costs land in the monthly figures (plan decision 12). */
export type SpendView = "amortized" | "charged";

export type SpendGroupBy = "day" | "month" | "scope" | "sku";

export type SeriesSource = "connector" | "recurring" | "manual";

export interface SpendVendor {
  id: string;
  name: string;
  category: string;
  /** `null` for a vendor with no billing API (recurring costs only). */
  connector: string | null;
  status: VendorStatus;
  status_reason: string | null;
  last_ok_at: string | null;
  newest_complete_day: string | null;
  expected_lag_hours: number | null;
  /** e.g. "as reported by GitHub billing usage API". */
  provenance: string | null;
  month_to_date_micros: number | null;
  ceiling_micros: number | null;
  ceiling_pct: number | null;
  today_micros: number | null;
  yesterday_micros: number | null;
  last_month_micros: number | null;
  /** A prepaid balance where known — a balance, never spend. */
  balance_micros: number | null;
}

export interface SpendSeriesRow {
  /** The day (`YYYY-MM-DD`), month, scope or SKU, by `group_by`. */
  key: string;
  vendor_id: string;
  net_micros: number | null;
  gross_micros: number | null;
  discount_micros: number | null;
  source: SeriesSource;
}

export interface SpendTotals {
  net_micros: number | null;
  partial: boolean;
  /** The NAMES of the vendors whose figures are not available. */
  unknown_vendors: string[];
}

export type AlertRule =
  | "mtd_threshold"
  | "daily_abs"
  | "spike"
  | "stale"
  | (string & {});

export type PushStatus =
  | "pending"
  | "accepted"
  | "delivered"
  | "failed"
  | "unknown_recipients"
  | "muted"
  | (string & {});

export interface SpendAlert {
  id: string;
  rule: AlertRule;
  scope_key: string;
  period_key: string;
  observed_micros: number | null;
  threshold_micros: number | null;
  fired_at: string;
  push_status: PushStatus;
  resolved_at: string | null;
  vendor_id: string | null;
  /** Delivery to coord as agent work: pending|sent|failed|unsupported|disabled. */
  coord_status: string;
  detail: Record<string, unknown>;
}

export interface SpendSummary {
  currency: string;
  view: SpendView;
  from: string;
  to: string;
  generated_at: string;
  vendors: SpendVendor[];
  series: SpendSeriesRow[];
  totals: SpendTotals;
  alerts: SpendAlert[];
}

export interface Renewal {
  id: string;
  vendor_id: string;
  vendor_name: string;
  description: string;
  external_ref: string | null;
  renews_on: string;
  amount_micros: number | null;
  currency: string;
  auto_renew: boolean | null;
}

export interface SummaryQuery {
  view: SpendView;
  groupBy: SpendGroupBy;
  vendor?: string | null;
  from?: string;
  to?: string;
}

export async function fetchSpendSummary(
  query: SummaryQuery
): Promise<SpendSummary> {
  const qs = new URLSearchParams({ view: query.view, group_by: query.groupBy });
  if (query.vendor) qs.set("vendor", query.vendor);
  if (query.from) qs.set("from", query.from);
  if (query.to) qs.set("to", query.to);
  return httpClient.get<SpendSummary>(`${SPEND_API}/summary?${qs.toString()}`);
}

export async function fetchRenewals(days = 60): Promise<Renewal[]> {
  const body = await httpClient.get<{ renewals: Renewal[] }>(
    `${SPEND_API}/renewals?days=${days}`
  );
  return body.renewals;
}
