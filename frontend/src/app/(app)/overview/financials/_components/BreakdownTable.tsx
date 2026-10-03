"use client";

/**
 * Where the money went over the window: by repository or service (scope), or
 * by the provider's SKU, with gross, discount and net kept apart. Gross and
 * discount read "not reported" where the provider does not report them —
 * the net alone is never back-filled into them.
 *
 * Choosing one provider is the drill-down from the chart: its scopes (a
 * GitHub repository, an AWS service) on their own.
 */

import { formatMicros } from "@/components/overview/money";
import { NotAvailable } from "@/components/overview/UnavailableNotes";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { Skeleton } from "@/components/ui/skeleton";
import { breakdownRows, formatDay } from "../_lib/spend";
import type { SpendSummary, SpendVendor } from "../_lib/spend-api";
import type { BreakdownBy, Loadable } from "../_lib/useSpend";
import { SegmentedRadio } from "./SegmentedRadio";

const BY_OPTIONS = [
  ["scope", "Repository or service"],
  ["sku", "SKU"],
] as const;

const SOURCE_WORD = {
  connector: "reported by the provider",
  recurring: "recurring cost",
  manual: "entered manually",
} as const;

function Money({
  micros,
  currency,
  label,
}: {
  micros: number | null;
  currency: string;
  label: string;
}) {
  const text = formatMicros(micros, currency, { maximumFractionDigits: 2 });
  return text === null ? <NotAvailable label={label} /> : <>{text}</>;
}

export function BreakdownTable({
  breakdown,
  vendors,
  by,
  onBy,
  vendor,
  onVendor,
}: {
  breakdown: Loadable<SpendSummary>;
  vendors: readonly SpendVendor[];
  by: BreakdownBy;
  onBy: (by: BreakdownBy) => void;
  vendor: string | null;
  onVendor: (vendor: string | null) => void;
}) {
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  const id = "overview.costs.breakdown";
  return (
    <div data-ui-bridge-id={id}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedRadio<BreakdownBy>
          legend="Break down by"
          value={by}
          options={BY_OPTIONS}
          onChange={onBy}
          uiBridgeId={`${id}.by`}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Provider
          <select
            value={vendor ?? ""}
            onChange={(e) => onVendor(e.target.value || null)}
            className="min-h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id={`${id}.vendor`}
          >
            <option value="">All providers</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {breakdown.state === "loading" && (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-10/12" />
        </div>
      )}
      {breakdown.state === "error" && (
        <LoadFailure
          what="the breakdown"
          message={breakdown.message}
          uiBridgeId={`${id}.error`}
          announce={false}
        />
      )}
      {breakdown.state === "ready" && (
        <div
          className={
            breakdown.refreshing ? "opacity-60 transition-opacity" : ""
          }
        >
          <BreakdownBody summary={breakdown.data} names={names} by={by} />
        </div>
      )}
    </div>
  );
}

function BreakdownBody({
  summary,
  names,
  by,
}: {
  summary: SpendSummary;
  names: Map<string, string>;
  by: BreakdownBy;
}) {
  const rows = breakdownRows(summary.series);
  const id = "overview.costs.breakdown";
  if (rows.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id={`${id}.empty`}
      >
        No provider reported a line between {formatDay(summary.from)} and{" "}
        {formatDay(summary.to)}. That is not the same as nothing spent — the
        sources below say which providers could be read.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Spend by {by === "scope" ? "repository or service" : "SKU"},{" "}
          {formatDay(summary.from)} to {formatDay(summary.to)}
        </caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Provider</th>
            <th className="py-2 pr-4 font-medium">
              {by === "scope" ? "Repository or service" : "SKU"}
            </th>
            <th className="py-2 pr-4 text-right font-medium">Gross</th>
            <th className="py-2 pr-4 text-right font-medium">Discount</th>
            <th className="py-2 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.vendorId}:${row.key}`}
              className="border-b border-border/50"
              data-ui-bridge-id={`${id}.row.${row.vendorId}.${row.key}`}
            >
              <td className="py-2 pr-4 text-muted-foreground">
                {names.get(row.vendorId) ?? row.vendorId}
              </td>
              <td className="py-2 pr-4 text-foreground">
                {row.key}
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.sources.map((s) => SOURCE_WORD[s] ?? s).join(", ")}
                </span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                <Money
                  micros={row.gross}
                  currency={summary.currency}
                  label="not reported"
                />
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                <Money
                  micros={row.discount}
                  currency={summary.currency}
                  label="not reported"
                />
              </td>
              <td className="py-2 text-right tabular-nums">
                {row.incomplete && row.net !== null && "at least "}
                <Money
                  micros={row.net}
                  currency={summary.currency}
                  label="not available"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        {summary.view === "amortized"
          ? "Yearly costs amortized monthly."
          : "Yearly costs charged on renewal."}{" "}
        Net is what the provider billed.
      </p>
    </div>
  );
}
