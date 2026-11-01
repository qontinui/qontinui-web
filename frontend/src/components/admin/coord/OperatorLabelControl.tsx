"use client";

/**
 * "Did this hold up? Yes · No · Can't tell" — the operator's one-click label
 * on ONE sampled verification verdict, on `/admin/coord/verification` only
 * (never on the overview tile). Plan
 * `2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured`,
 * Phase 4.
 *
 * Optional by construction: nothing waits on it and nothing is hidden behind
 * it. A click posts the label (`recordOperatorLabel`) and the control then
 * shows what came back — the row coord recorded, "already labelled" for a
 * verdict labelled before, or why it was not recorded. Only an outcome that
 * is not known either way is amber and offers "Answer again"; a definite
 * refusal (403, 404, 422, any other 4xx, the web's own 502s) is final and
 * muted (console style R3). The line truncates with a title (R2). The words are derived in
 * `verificationMetrics.ts` (`operatorLabelOutcome`, console style R8).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  recordOperatorLabel,
  type OperatorLabelResult,
  type OperatorLabelTruth,
} from "@/lib/api/operations/coordVerification";
import { cn } from "@/lib/utils";
import {
  OPERATOR_LABEL_CHOICES,
  operatorLabelOutcome,
} from "./verificationMetrics";

type ControlState =
  | { status: "idle" }
  | { status: "sending"; truth: OperatorLabelTruth }
  | { status: "done"; result: OperatorLabelResult };

/**
 * Sizing is the control's own, by state, because it is meant to sit directly
 * in a one-line flex row (console style R2): the idle button group is
 * `shrink-0` (the buttons are never clipped — the row's label gives way), and
 * the outcome is `min-w-0` with its text truncating under a `title`, so a long
 * answer never pushes the row wider than a phone. `className` adds the
 * caller's bound (e.g. a max width) to whichever state is showing.
 */
export function OperatorLabelControl({
  verificationId,
  className,
}: {
  verificationId: string;
  className?: string;
}) {
  const [state, setState] = useState<ControlState>({ status: "idle" });

  const send = async (truth: OperatorLabelTruth) => {
    setState({ status: "sending", truth });
    const result = await recordOperatorLabel(verificationId, truth);
    setState({ status: "done", result });
  };

  if (state.status === "done") {
    const outcome = operatorLabelOutcome(state.result);
    return (
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-2 text-xs",
          outcome.attention
            ? "text-amber-700 dark:text-amber-300"
            : "text-muted-foreground",
          className
        )}
        role="status"
        data-testid="coord-verification-label-outcome"
        data-label-outcome={state.result.kind}
      >
        <span className="min-w-0 truncate" title={outcome.text}>
          {outcome.text}
        </span>
        {outcome.retry && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => setState({ status: "idle" })}
            data-testid="coord-verification-label-again"
          >
            Answer again
          </Button>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
        className
      )}
      role="group"
      aria-label="Did this hold up?"
      data-testid="coord-verification-label-control"
    >
      {/* The group's aria-label carries the question on every width. */}
      <span className="hidden sm:inline">Did this hold up?</span>
      {OPERATOR_LABEL_CHOICES.map((c) => (
        <Button
          key={c.truth}
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={state.status === "sending"}
          aria-busy={state.status === "sending" && state.truth === c.truth}
          onClick={() => void send(c.truth)}
          data-testid={`coord-verification-label-${c.truth}`}
        >
          {c.label}
        </Button>
      ))}
    </span>
  );
}
