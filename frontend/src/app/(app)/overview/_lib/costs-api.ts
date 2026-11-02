/**
 * The wire shapes the Costs page reads and writes: cost categories,
 * recurring costs, cost entries, and the summary.
 *
 * The three record kinds are resources on the overview authoring contract,
 * read and written through the kit (`useResourceList("cost-entries")`, …),
 * which carries `If-Match`, the 409 with the server's copy and the change
 * log. The summary is a read beyond the contract, like the Timeline's
 * forecast: every total and every recurring period comes from the server
 * (`app/services/overview_costs.py`), so this page adds nothing up itself.
 *
 * Money is integer micros beside an ISO currency; a figure that is not known
 * is `null`, never 0.
 */

import { httpClient } from "@/services/service-factory";
import { OVERVIEW_API } from "@/components/overview/editing/api";

/** Registry names and route segments. */
export const COST_CATEGORIES = "cost_categories";
export const COST_CATEGORIES_PATH = "cost-categories";
export const RECURRING_COSTS = "recurring_costs";
export const RECURRING_COSTS_PATH = "recurring-costs";
export const COST_ENTRIES = "cost_entries";
export const COST_ENTRIES_PATH = "cost-entries";

interface Audited {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CostCategory extends Audited {
  name: string;
  description: string;
  sort_order: number;
}

export type Cadence = "monthly" | "quarterly" | "annual";
export type AmountKind = "fixed" | "variable";

export interface RecurringCost extends Audited {
  name: string;
  vendor: string;
  category_id: string | null;
  cadence: Cadence;
  /** `fixed` charges `amount_micros` every period; `variable` needs each
   *  period's amount entered, and `amount_micros` is only a typical figure. */
  amount_kind: AmountKind;
  amount_micros: number | null;
  currency: string;
  start_date: string;
  end_date: string | null;
  notes: string;
}

export interface CostEntry extends Audited {
  incurred_on: string;
  description: string;
  vendor: string;
  category_id: string | null;
  /** The total paid; negative is a refund. */
  amount_micros: number;
  currency: string;
  quantity: number;
  /** A physical item that has to arrive; `received_on` is when it did. */
  expects_delivery: boolean;
  received_on: string | null;
  order_ref: string;
  notes: string;
  /** Set together when this entry records one period of a recurring cost. */
  recurring_cost_id: string | null;
  period_start: string | null;
}

export interface CurrencyTotals {
  currency: string;
  spent_to_date_micros: number;
  /** The part of `spent_to_date_micros` that is scheduled (a fixed
   *  recurring cost fell due and nothing was recorded for it). */
  scheduled_micros: number;
  this_month_micros: number;
  awaiting_delivery_micros: number;
}

export interface MonthCategoryTotal {
  /** The first day of the month. */
  month: string;
  category_id: string | null;
  currency: string;
  recorded_micros: number;
  scheduled_micros: number;
}

export type PeriodState = "recorded" | "scheduled" | "awaiting_amount";

export interface RecurringPeriod {
  recurring_cost_id: string;
  period_start: string;
  state: PeriodState;
  entry_id: string | null;
  /** `null` while awaiting its amount. */
  amount_micros: number | null;
  currency: string;
}

export interface CostSummary {
  today: string;
  base_currency: string;
  currencies: CurrencyTotals[];
  months: MonthCategoryTotal[];
  /** Every period that has fallen due, newest first. */
  periods: RecurringPeriod[];
  awaiting_delivery_count: number;
  awaiting_amount_count: number;
}

export function fetchCostSummary(): Promise<CostSummary> {
  return httpClient.get<CostSummary>(`${OVERVIEW_API}/costs/summary`);
}
