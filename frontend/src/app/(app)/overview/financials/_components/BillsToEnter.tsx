"use client";

/**
 * The periods of recurring costs that vary (AWS, GitHub usage, …) which have
 * fallen due and have no amount yet — each with an amount box that records
 * it as a cost entry for exactly that period. Until then the summary leaves
 * the period out and counts it, so a missing bill never reads as zero.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseAmountToMicros } from "@/components/overview/money";
import type { SaveResult } from "@/components/overview/editing/useResource";
import type {
  CostEntry,
  RecurringCost,
  RecurringPeriod,
} from "../../_lib/costs-api";
import { CADENCE_LABEL } from "../../_lib/costs";
import { formatDay } from "../../_lib/timeline";

function key(p: RecurringPeriod): string {
  return `${p.recurring_cost_id}:${p.period_start}`;
}

export function BillsToEnter({
  periods,
  recurring,
  canEdit,
  create,
  onWritten,
}: {
  periods: RecurringPeriod[];
  recurring: RecurringCost[];
  canEdit: boolean;
  create: (body: Record<string, unknown>) => Promise<SaveResult<CostEntry>>;
  onWritten: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const byId = new Map(recurring.map((r) => [r.id, r]));
  const owed = periods.filter((p) => p.state === "awaiting_amount");

  if (owed.length === 0) return null;

  const save = async (period: RecurringPeriod) => {
    const cost = byId.get(period.recurring_cost_id);
    if (!cost) return;
    const k = key(period);
    const micros = parseAmountToMicros(amounts[k] ?? "");
    if (micros === null) {
      setErrors((e) => ({ ...e, [k]: "Enter the amount, e.g. 412.50." }));
      return;
    }
    setSaving(k);
    const result = await create({
      recurring_cost_id: cost.id,
      period_start: period.period_start,
      incurred_on: period.period_start,
      description: cost.name,
      vendor: cost.vendor,
      category_id: cost.category_id,
      amount_micros: micros,
      currency: cost.currency,
    });
    setSaving(null);
    if (result.ok) {
      setErrors((e) => ({ ...e, [k]: "" }));
      onWritten();
    } else {
      setErrors((e) => ({
        ...e,
        [k]: "error" in result ? result.error : "Could not save it.",
      }));
    }
  };

  return (
    <div className="space-y-2" data-ui-bridge-id="overview.costs.bills">
      <h3 className="text-sm font-medium text-foreground">
        Bills waiting for their amount
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {owed.map((period) => {
          const cost = byId.get(period.recurring_cost_id);
          const k = key(period);
          return (
            <li
              key={k}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              data-ui-bridge-id={`overview.costs.bills.${k}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {cost?.name ?? "A recurring cost"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[
                    cost ? CADENCE_LABEL[cost.cadence] : null,
                    `due ${formatDay(period.period_start)}`,
                    cost?.vendor || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {errors[k] && (
                  <div role="alert" className="mt-1 text-xs text-destructive">
                    {errors[k]}
                  </div>
                )}
              </div>
              {canEdit ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(period);
                  }}
                >
                  <Input
                    inputMode="decimal"
                    aria-label={`Amount for ${cost?.name ?? "this bill"}, due ${formatDay(period.period_start)}, in ${period.currency}`}
                    placeholder="Amount"
                    className="h-9 w-28 text-right tabular-nums"
                    value={amounts[k] ?? ""}
                    onChange={(e) =>
                      setAmounts((a) => ({ ...a, [k]: e.target.value }))
                    }
                    data-ui-bridge-id={`overview.costs.bills.${k}.amount`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {period.currency}
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={saving !== null}
                    data-ui-bridge-id={`overview.costs.bills.${k}.save`}
                  >
                    {saving === k ? "Saving…" : "Record"}
                  </Button>
                </form>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Not entered yet
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
