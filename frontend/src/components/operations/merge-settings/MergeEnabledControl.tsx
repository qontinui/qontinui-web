"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { writeMergeEnabled } from "@/lib/api/operations/prMerge";
import { httpErrorText } from "./httpError";
import { pinSentence, type PinChoice } from "./pinChoice";

const log = createLogger("MergeOrchestrationSettings");

/**
 * Per-repo merge-enablement control: one switch, plus a clear-the-pin action.
 *
 * The switch position is the PIN when there is one and the resolved value when
 * there is not, and the line under it always says which of those you are
 * looking at — an operator flipping this must never be surprised about what
 * they were flipping FROM.
 *
 * Reason is collected via window.prompt and enabling is guarded by
 * window.confirm — the same minimal-dependency confirmation discipline the
 * emergency stop uses.
 */
export function MergeEnabledControl({
  repo,
  resolved,
  pin,
  tenantPaused = false,
  onChanged,
}: {
  repo: string;
  resolved: boolean;
  pin: PinChoice;
  tenantPaused?: boolean;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = useCallback(
    async (enabled: boolean | null, promptLabel: string) => {
      setError(null);
      const reason = window.prompt(
        `${repo}: ${promptLabel} Reason (required):`
      );
      if (reason === null) return;
      if (reason.trim().length === 0) {
        setError("Reason is required.");
        return;
      }
      if (
        enabled === true &&
        !window.confirm(
          `${repo}: the orchestrator will start pushing REAL merges to main ` +
            "for green, unblocked PRs in this repo. Proceed?"
        )
      ) {
        return;
      }
      setSubmitting(true);
      try {
        await writeMergeEnabled({
          scope: `repo:${repo}`,
          enabled,
          reason: reason.trim(),
        });
        onChanged();
      } catch (err) {
        log.warn("merge-enabled write failed", err);
        setError(httpErrorText(err, { withBody: true }));
      } finally {
        setSubmitting(false);
      }
    },
    [repo, onChanged]
  );

  // Pinned → show the PIN (this switch edits the pin, so it must show the
  // thing it edits). Not pinned → show what it resolves to. Either way the
  // sentence below carries the resolved value whenever the two disagree, so a
  // pinned-ON switch under a tenant pause never reads as "merges are running".
  const checked = pin === "inherit" ? resolved : pin === "true";
  return (
    <div className="pt-1 border-t border-border/40 space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={`merge-enabled-${repo}`} className="text-xs">
          Merge enabled
        </Label>
        <Switch
          id={`merge-enabled-${repo}`}
          checked={checked}
          disabled={submitting}
          onCheckedChange={(next) =>
            void write(
              next,
              next
                ? "pin merges ON for this repo."
                : "pin merges OFF for this repo."
            )
          }
          data-testid={`merge-enabled-switch-${repo}`}
        />
        {pin !== "inherit" && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={submitting}
            onClick={() =>
              void write(null, "clear the pin and inherit the tenant default.")
            }
            data-testid={`merge-enabled-clear-${repo}`}
          >
            Clear pin
          </Button>
        )}
      </div>
      <p
        className="text-muted-foreground"
        data-testid={`merge-enabled-provenance-${repo}`}
      >
        {pinSentence(pin, resolved, tenantPaused)}
      </p>
      {error && (
        <p className="text-red-300 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
