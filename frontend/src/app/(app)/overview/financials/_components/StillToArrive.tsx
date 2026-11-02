"use client";

/**
 * What has been paid for and has not arrived — every cost marked as a
 * delivered item with no received date, oldest order first, with how long
 * it has been waiting and a one-click "Received today".
 */

import { useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { formatMicros } from "@/components/overview/money";
import type { SaveResult } from "@/components/overview/editing/useResource";
import type { CostEntry } from "../../_lib/costs-api";
import { formatDay, isoDay, toDay } from "../../_lib/timeline";

export function StillToArrive({
  entries,
  categoryName,
  canEdit,
  today,
  update,
  onWritten,
}: {
  entries: CostEntry[];
  categoryName: (id: string | null) => string | null;
  canEdit: boolean;
  /** The server's today, so "waiting" agrees with the summary. */
  today: string;
  update: (
    current: CostEntry,
    patch: Record<string, unknown>
  ) => Promise<SaveResult<CostEntry>>;
  onWritten: () => void;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const waiting = entries
    .filter((e) => e.expects_delivery && !e.received_on)
    .sort((a, b) => a.incurred_on.localeCompare(b.incurred_on));
  const now = toDay(today) ?? new Date();

  if (waiting.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id="overview.costs.arrive.empty"
      >
        Everything ordered has arrived. Mark a cost as a delivered item to track
        it here until it does.
      </p>
    );
  }

  const receive = async (entry: CostEntry) => {
    setSaving(entry.id);
    const result = await update(entry, { received_on: isoDay(new Date()) });
    setSaving(null);
    if (result.ok) {
      setErrors([]);
      onWritten();
    } else {
      setErrors([
        `${entry.description}: ${
          "error" in result
            ? result.error
            : "somebody else changed it — check it in the table below."
        }`,
      ]);
    }
  };

  return (
    <div className="space-y-3" data-ui-bridge-id="overview.costs.arrive">
      <ul className="divide-y divide-border rounded-md border border-border">
        {waiting.map((entry) => {
          const ordered = toDay(entry.incurred_on);
          const days = ordered ? differenceInCalendarDays(now, ordered) : null;
          const category = categoryName(entry.category_id);
          return (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              data-ui-bridge-id={`overview.costs.arrive.item.${entry.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {entry.description}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[
                    entry.vendor || null,
                    category,
                    entry.order_ref ? `Order ${entry.order_ref}` : null,
                    `ordered ${formatDay(entry.incurred_on)}`,
                    days !== null && days > 0
                      ? `waiting ${days} day${days === 1 ? "" : "s"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="text-sm tabular-nums text-foreground">
                {formatMicros(entry.amount_micros, entry.currency, {
                  maximumFractionDigits: 2,
                })}
              </div>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving !== null}
                  onClick={() => void receive(entry)}
                  data-ui-bridge-id={`overview.costs.arrive.receive.${entry.id}`}
                >
                  {saving === entry.id ? "Saving…" : "Received today"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
