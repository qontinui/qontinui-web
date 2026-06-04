"use client";

/**
 * LandPrecisionPanel — per-dimension precision/recall calibration for the
 * land predictor.
 *
 * Plan `2026-05-31-push-land-action-effect-signatures-plan.md` Phase 4 §2
 * (click-through to per-dimension prediction confidence; calibration).
 *
 * HONESTY ABOUT UNCERTAINTY (binding UX priority): coord returns
 * `precision`/`recall` as `null` when undefined (zero-division — no
 * positive predictions, or no actual positives). We render "no data yet"
 * for nulls and NEVER fabricate a 0% or 100%. `formatRate` is the single
 * source of that rule and is unit-tested.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge } from "lucide-react";

export interface PrecisionDimension {
  dimension: string;
  true_positive?: number | null;
  false_positive?: number | null;
  true_negative?: number | null;
  false_negative?: number | null;
  total?: number | null;
  precision?: number | null;
  recall?: number | null;
}

export interface PrecisionResponse {
  dimensions?: PrecisionDimension[] | null;
}

/**
 * Format a precision/recall rate. `null`/`undefined` (coord's zero-division
 * honesty) → "no data yet"; a finite [0,1] fraction → a percentage.
 *
 * Exported + unit-tested so the "never fabricate 0%/100% for null" contract
 * can't silently regress.
 */
export function formatRate(rate?: number | null): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) {
    return "no data yet";
  }
  return `${Math.round(rate * 100)}%`;
}

function num(n?: number | null): number {
  return typeof n === "number" ? n : 0;
}

export function LandPrecisionPanel({
  data,
  loading,
}: {
  data: PrecisionResponse | null;
  loading: boolean;
}) {
  const dims = data?.dimensions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />
          Predictor calibration (per dimension)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading && dims.length === 0 ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : dims.length === 0 ? (
          <p className="text-sm text-muted-foreground italic p-4">
            No land predictions scored yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="coord-land-precision-table"
            >
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2">Dimension</th>
                  <th className="px-4 py-2 text-right">Precision</th>
                  <th className="px-4 py-2 text-right">Recall</th>
                  <th className="px-4 py-2 text-right">TP</th>
                  <th className="px-4 py-2 text-right">FP</th>
                  <th className="px-4 py-2 text-right">TN</th>
                  <th className="px-4 py-2 text-right">FN</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {dims.map((d) => {
                  const precNull =
                    d.precision === null || d.precision === undefined;
                  const recallNull =
                    d.recall === null || d.recall === undefined;
                  return (
                    <tr
                      key={d.dimension}
                      data-testid="coord-land-precision-row"
                      className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2 font-medium uppercase">
                        {d.dimension}
                      </td>
                      <td
                        className={
                          "px-4 py-2 text-right tabular-nums " +
                          (precNull ? "text-muted-foreground italic" : "")
                        }
                        data-testid="coord-land-precision-cell"
                      >
                        {formatRate(d.precision)}
                      </td>
                      <td
                        className={
                          "px-4 py-2 text-right tabular-nums " +
                          (recallNull ? "text-muted-foreground italic" : "")
                        }
                        data-testid="coord-land-recall-cell"
                      >
                        {formatRate(d.recall)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(d.true_positive)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(d.false_positive)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(d.true_negative)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(d.false_negative)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {num(d.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
