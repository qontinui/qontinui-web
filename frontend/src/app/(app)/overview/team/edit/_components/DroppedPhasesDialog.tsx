"use client";

/**
 * Saving would drop saved phases that hold recorded work. Say which, and what
 * each would lose, before anything is written — and let the writer go back
 * or go ahead, knowingly.
 *
 * Shown only when something is at risk (`DropCheck` `at_risk`) or when that
 * could not be found out (`unknown`): a check that failed is said, never
 * passed off as "nothing to lose". Shown again, with what each phase holds
 * NOW, when the server refused the Save because that changed after the check. Closing without a choice is Cancel —
 * nothing has been written.
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DropCheck, PhaseLoss } from "../_lib/dropped";

function sentence(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function Loss({ loss, uiBridgeId }: { loss: PhaseLoss; uiBridgeId: string }) {
  const { phase, progress, milestones } = loss;
  return (
    <li data-ui-bridge-id={`${uiBridgeId}.phase.${phase.code}`}>
      <p className="text-sm text-foreground">
        <span className="font-mono text-xs text-muted-foreground">
          {phase.code}
        </span>{" "}
        {phase.name}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
        {progress.length > 0 && (
          <li>Its recorded {sentence(progress)} will be deleted.</li>
        )}
        {milestones > 0 && (
          <li>
            {milestones === 1
              ? "1 milestone will be untied from it"
              : `${milestones} milestones will be untied from it`}{" "}
            (kept, with no phase).
          </li>
        )}
      </ul>
    </li>
  );
}

export function DroppedPhasesDialog({
  check,
  onCancel,
  onConfirm,
  uiBridgeId,
}: {
  /** `null` (or `clear`) keeps the dialog closed. */
  check: DropCheck | null;
  onCancel: () => void;
  onConfirm: () => void;
  uiBridgeId: string;
}) {
  const open = check !== null && check.kind !== "clear";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        data-ui-bridge-id={uiBridgeId}
      >
        {check?.kind === "at_risk" && (
          <>
            <DialogHeader>
              <DialogTitle>
                Saving drops{" "}
                {check.losses.length === 1
                  ? "a phase that holds"
                  : "phases that hold"}{" "}
                recorded work
              </DialogTitle>
              <DialogDescription>
                The schedule you are saving no longer has{" "}
                {check.losses.length === 1 ? "this phase" : "these phases"}. A
                phase is kept only while its code is: a chart that renamed a
                code brings in a new phase and drops the old one.
              </DialogDescription>
            </DialogHeader>
            {check.fresh && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 p-3 text-sm text-foreground"
                data-ui-bridge-id={`${uiBridgeId}.changed`}
              >
                Nothing was saved:{" "}
                {check.losses.length === 1
                  ? "this phase holds"
                  : "these phases hold"}{" "}
                recorded work the save did not account for. What{" "}
                {check.losses.length === 1 ? "it holds" : "each holds"} now is
                below.
              </p>
            )}
            <ul
              className="space-y-3"
              data-ui-bridge-id={`${uiBridgeId}.losses`}
            >
              {check.losses.map((loss) => (
                <Loss
                  key={loss.phase.code}
                  loss={loss}
                  uiBridgeId={uiBridgeId}
                />
              ))}
            </ul>
          </>
        )}
        {check?.kind === "unknown" && (
          <>
            <DialogHeader>
              <DialogTitle>
                What the dropped phases hold could not be checked
              </DialogTitle>
              <DialogDescription>
                Saving drops{" "}
                {check.dropped
                  .map((phase) => `${phase.code} ${phase.name}`)
                  .join(", ")}
                . Whether any of them has a recorded gate outcome, actual dates
                or milestones tied to it could not be found out, so nothing here
                can say it is safe. If one has, saving deletes that progress and
                unties those milestones.
              </DialogDescription>
            </DialogHeader>
            <p
              role="alert"
              className="rounded-md border border-destructive/40 p-3 text-sm text-foreground"
              data-ui-bridge-id={`${uiBridgeId}.reason`}
            >
              {check.reason}
            </p>
          </>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            data-ui-bridge-id={`${uiBridgeId}.cancel`}
          >
            Cancel, keep editing
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            data-ui-bridge-id={`${uiBridgeId}.confirm`}
          >
            {check?.kind === "unknown" ? "Save anyway" : "Drop them and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
