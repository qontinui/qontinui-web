"use client";

/**
 * VisualDriftDetail — renders a `kind: "visual-drift"` drift entry by
 * reusing the existing `VisualDiffViewer` from the visual-regression
 * subsystem.
 *
 * The bridge here is a small adapter that maps the upstream `DriftEntry`
 * shape (numeric drift fields + a single bounding rect) into the
 * testing-service's `DiffRegion[]` shape that the viewer consumes. Pixel
 * counts come straight through; the bounding rect becomes a single-region
 * array so the existing overlay renders without changes.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Image as ImageIcon } from "lucide-react";
import { VisualDiffViewer } from "@/components/testing/visual-regression";
import type { DiffRegion } from "@/services/testing-service";
import type { VisualDriftEntryView } from "./drift-api";

export interface VisualDriftDetailProps {
  runId: string;
  entry: VisualDriftEntryView;
}

/**
 * Convert a `VisualDriftEntryView` into the `DiffRegion[]` shape the
 * existing visual-regression viewer expects.
 *
 * - The upstream report carries a single optional bounding `diffRegion`.
 * - `change_percentage` in `DiffRegion` is 0..1; the upstream
 *   `diffPercentage` is 0..100, so we divide by 100.
 * - `pixel_count` maps directly from `diffPixelCount`.
 */
export function adaptVisualDriftToRegions(
  entry: VisualDriftEntryView,
): DiffRegion[] {
  if (!entry.diffRegion) return [];
  return [
    {
      x: entry.diffRegion.x,
      y: entry.diffRegion.y,
      width: entry.diffRegion.width,
      height: entry.diffRegion.height,
      change_percentage: clamp01(entry.diffPercentage / 100),
      pixel_count: entry.diffPixelCount,
    },
  ];
}

export function VisualDriftDetail({ runId, entry }: VisualDriftDetailProps) {
  void runId;
  const diffRegions = adaptVisualDriftToRegions(entry);
  const similarity = clamp01(1 - entry.diffPercentage / 100);
  const pctRounded = Math.round(entry.diffPercentage * 10) / 10;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="size-4 text-muted-foreground" />
              <span className="font-mono">{entry.id}</span>
            </CardTitle>
            <Badge variant="destructive">Visual drift</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{entry.detail}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            <Stat label="Diff" value={`${pctRounded}%`} />
            <Stat label="Pixels" value={entry.diffPixelCount.toLocaleString()} />
            <Stat
              label="Total"
              value={entry.totalPixels.toLocaleString()}
            />
            <Stat
              label="Baseline"
              value={entry.baselineKey ?? "—"}
              mono
              truncate
            />
          </div>
        </CardHeader>
        <CardContent>
          <VisualDiffViewer
            baselineUrl={entry.baselineUrl ?? null}
            screenshotUrl={entry.screenshotUrl ?? null}
            diffUrl={entry.diffUrl ?? null}
            diffRegions={diffRegions}
            similarityScore={similarity}
            threshold={entry.threshold}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={[
          "text-sm",
          mono ? "font-mono" : "",
          truncate ? "truncate" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export default VisualDriftDetail;
