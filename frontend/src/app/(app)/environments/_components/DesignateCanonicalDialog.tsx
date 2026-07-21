"use client";

import { useId, useState } from "react";
import { Crown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CANONICAL_NOTE_MAX_LEN } from "@/services/devenv-api";

interface DesignateCanonicalDialogProps {
  /** Name of the machine about to become canonical; null closes the dialog. */
  machineName: string | null;
  /** Name of the machine losing the designation, if there was one. */
  currentCanonicalName: string | null;
  /** True while the PUT is in flight — keeps the dialog open and disabled. */
  saving: boolean;
  /** Confirm with the (possibly blank) note the operator typed. */
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

/**
 * Confirms a canonical designation and captures the optional "why".
 *
 * Two reasons this is a dialog rather than an inline field:
 *
 * 1. **The note has to be typed after choosing.** The reason belongs to the
 *    change, so asking for it before the dropdown selection would invert the
 *    order the operator thinks in.
 * 2. **Designating canonical re-points every other machine's drift.** It was
 *    previously a single unconfirmed click on a dropdown item; a confirm step
 *    is proportionate to a change everyone on the environment sees.
 *
 * The note is optional on purpose — an unexplained change is still fully
 * attributable (who/when/from→to), and forcing prose would only yield ".".
 *
 * Built on `Dialog`, not `AlertDialog`, because it hosts an input: AlertDialog
 * forces focus onto its action button and is meant for confirm/deny with no
 * field to fill in. `CopyCanonicalDialog` next door makes the same call.
 *
 * The parent gives this a `key` per designation, so each one mounts fresh with
 * an empty note rather than needing a reset effect.
 */
export function DesignateCanonicalDialog({
  machineName,
  currentCanonicalName,
  saving,
  onConfirm,
  onCancel,
}: DesignateCanonicalDialogProps) {
  const [note, setNote] = useState("");
  const noteId = useId();
  const open = machineName !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never dismiss mid-request: the PUT would land with the UI already
        // closed and the operator unsure whether it took.
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="size-5" />
            Make {machineName} canonical?
          </DialogTitle>
          <DialogDescription>
            {currentCanonicalName
              ? `Every machine's drift is recomputed against ${machineName} instead of ${currentCanonicalName}.`
              : `Every machine's drift is recomputed against ${machineName}.`}{" "}
            The change is recorded in the canonical history with your name and
            the time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={noteId} className="text-xs">
            Reason <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={CANONICAL_NOTE_MAX_LEN}
            disabled={saving}
            rows={3}
            placeholder="e.g. rebuilt this box from the current lockfiles"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Saved with the change so a teammate reading the history later knows
            why it moved.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={() => onConfirm(note)}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Crown className="size-4" />
            )}
            Make canonical
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
