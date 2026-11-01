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
 * verdict labelled before, or why it was not recorded. The words are derived
 * in `verificationMetrics.ts` (`operatorLabelOutcome`, console style R8).
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

export function OperatorLabelControl({
  verificationId,
}: {
  verificationId: string;
}) {
  const [state, setState] = useState<ControlState>({ status: "idle" });

  const send = async (truth: OperatorLabelTruth) => {
    setState({ status: "sending", truth });
    const result = await recordOperatorLabel(verificationId, truth);
    setState({ status: "done", result });
  };

  if (state.status === "done") {
    const outcome = operatorLabelOutcome(state.result);
    const retryable =
      state.result.kind !== "recorded" &&
      state.result.kind !== "already_labelled";
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-xs",
          outcome.attention
            ? "text-amber-700 dark:text-amber-300"
            : "text-muted-foreground"
        )}
        role="status"
        data-testid="coord-verification-label-outcome"
        data-label-outcome={state.result.kind}
      >
        {outcome.text}
        {retryable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
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
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      role="group"
      aria-label="Did this hold up?"
      data-testid="coord-verification-label-control"
    >
      Did this hold up?
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
