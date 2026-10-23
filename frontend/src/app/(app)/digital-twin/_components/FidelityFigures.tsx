"use client";

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UNKNOWN_AMBER } from "@/components/console";
import { Provenance, usePresentationMode } from "@/components/presentation";
import { cn } from "@/lib/utils";
import { FIDELITY_LABEL, type FidelityFigure } from "../_lib/twin-aspects";

/** The word an unknown figure renders as — never a blank, never a zero. */
export const FIGURE_UNKNOWN = "UNKNOWN";

function FigureValue({
  figure,
  presenting,
}: {
  figure: FidelityFigure;
  presenting: boolean;
}) {
  if (figure.state === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        reading…
      </span>
    );
  }
  if (figure.state === "unknown") {
    return (
      <>
        <Badge
          variant="outline"
          className={cn("text-[11px] font-semibold", UNKNOWN_AMBER)}
        >
          {FIGURE_UNKNOWN}
        </Badge>
        <p className="text-xs text-muted-foreground">{figure.reason}</p>
      </>
    );
  }
  return (
    <>
      <span
        className={cn(
          "font-semibold tabular-nums",
          presenting ? "text-xl" : "text-base"
        )}
      >
        {figure.value}
      </span>
      <p className="text-xs text-muted-foreground">{figure.detail}</p>
    </>
  );
}

/**
 * An aspect's fidelity figures — observed, coverage, staleness, honesty. An
 * unknown figure says UNKNOWN and why; every figure carries its source and
 * as-of time beside it in presentation mode (`Provenance`), including an
 * unknown one, whose as-of is when the attempt that failed was made.
 */
export function FidelityFigures({
  figures,
  testIdPrefix,
}: {
  figures: readonly FidelityFigure[];
  /** `<prefix>-<key>` is each figure's `data-testid`. */
  testIdPrefix: string;
}) {
  const { presenting } = usePresentationMode();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {figures.map((figure) => (
        <div
          key={figure.key}
          data-testid={`${testIdPrefix}-${figure.key}`}
          data-fidelity-state={figure.state}
          className="flex min-w-0 flex-col gap-0.5"
        >
          {/* dt before dd in the DOM (a valid <dl>); the value reads first. */}
          <dt className="order-2 text-xs text-muted-foreground">
            {FIDELITY_LABEL[figure.key]}
          </dt>
          <dd className="order-1 flex flex-col items-start gap-1">
            <FigureValue figure={figure} presenting={presenting} />
            {figure.state !== "loading" && (
              <Provenance source={figure.source} asOf={figure.asOf} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
