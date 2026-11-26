"use client";

/**
 * The one way the Timeline says a figure is not available: "Not available
 * since 21 Nov 2025 — it was not recorded".
 *
 * Every `Resolved` that is unknown renders through this, so no figure has an
 * ad hoc fallback of its own, and none can fall back to a default (`0 days`,
 * "On track", "Planned") that the figure never had.
 */

import { describeUnknown } from "../../_lib/schedule";
import type { UnknownReason } from "../../_lib/schedule-api";

export function UnknownFigure({
  figure,
  uiBridgeId,
  className,
}: {
  figure: {
    unknown_since?: string | null;
    unknown_reason?: UnknownReason | null;
  };
  uiBridgeId: string;
  className?: string;
}) {
  const text = describeUnknown(figure);
  return (
    <span
      className={className ?? "text-muted-foreground"}
      data-ui-bridge-id={uiBridgeId}
      data-unknown="true"
      data-unknown-reason={figure.unknown_reason ?? undefined}
    >
      {text.headline}
      {text.reason && <span className="text-xs"> — {text.reason}</span>}
    </span>
  );
}
