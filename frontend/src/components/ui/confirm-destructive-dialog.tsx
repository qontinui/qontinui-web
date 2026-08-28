"use client";

/**
 * ConfirmDestructiveDialog — the console's one confirmation primitive for
 * irreversible actions.
 *
 * It exists because {@link DestructiveButton} is NOT a confirmation, despite
 * a name that invites the assumption: it only refuses *synthetic* clicks
 * (`event.isTrusted === false`), so a real user's first click on a bare
 * `DestructiveButton` still fires the action immediately. The idiom that
 * actually confirms — an `AlertDialog` whose confirm control is a
 * `DestructiveButton` — was hand-rolled per-surface (see
 * `admin/coord/gates/_components/GateActions.tsx`), which is why
 * `admin/coord/members/page.tsx` shipped four bare `DestructiveButton`s and
 * zero `AlertDialog`s. This is that idiom as one component.
 *
 * Three things it adds over an inline dialog:
 *
 * 1. **Type-to-confirm.** Pass `confirmPhrase` and the confirm button stays
 *    disabled until the operator types that exact string. Reserved for
 *    actions with no undo — it is a real cost, so a dialog that does not
 *    need it should not pay it.
 * 2. **Blast radius in the dialog.** `children` render between the
 *    description and the confirm row: what this action is about to affect,
 *    shown at the moment of decision rather than after it.
 * 3. **A place for a scoped override.** `extra` renders below the blast
 *    radius, for the checkbox an endpoint-level override needs.
 *
 * Controlled on purpose: the caller owns `open`, so the trigger can be any
 * control (a table-row button, a dropdown item) and the dialog can be opened
 * from code paths that are not a click.
 */

import * as React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConfirmDestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Question form, e.g. "Delete the group acme-devs?". */
  title: React.ReactNode;
  /** What the action does and what it cannot undo. */
  description: React.ReactNode;
  /** Label on the confirming button. Defaults to "Delete". */
  confirmLabel?: string;
  /**
   * When set, the operator must type this string EXACTLY before the confirm
   * button enables. Leave undefined for a plain confirm.
   */
  confirmPhrase?: string;
  /** Label above the type-to-confirm field. */
  confirmPhraseLabel?: React.ReactNode;
  /** Disables the confirm button while a request is in flight. */
  busy?: boolean;
  /** Additional caller-owned reason to keep confirm disabled. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  /** Blast radius — what this action is about to affect. */
  children?: React.ReactNode;
  /** Scoped overrides (checkboxes) shown below the blast radius. */
  extra?: React.ReactNode;
  /** `data-testid` on the dialog content; sub-elements derive from it. */
  testId?: string;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  confirmPhrase,
  confirmPhraseLabel,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  children,
  extra,
  testId = "confirm-destructive-dialog",
}: ConfirmDestructiveDialogProps) {
  const [typed, setTyped] = React.useState("");

  // Reset on every open so a previous session's typing never pre-satisfies
  // the gate — the whole point is a fresh, deliberate keystroke.
  React.useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const phraseSatisfied = !confirmPhrase || typed === confirmPhrase;
  const inputId = `${testId}-phrase`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {children ? (
          <div
            className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-2"
            data-testid={`${testId}-blast-radius`}
          >
            {children}
          </div>
        ) : null}

        {extra ? <div className="space-y-2">{extra}</div> : null}

        {confirmPhrase ? (
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>
              {confirmPhraseLabel ?? (
                <>
                  Type <span className="font-mono">{confirmPhrase}</span> to
                  confirm
                </>
              )}
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={confirmPhrase}
              aria-required
              data-testid={`${testId}-phrase-input`}
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${testId}-cancel`}>
            Cancel
          </AlertDialogCancel>
          <DestructiveButton
            onClick={onConfirm}
            disabled={busy || confirmDisabled || !phraseSatisfied}
            data-testid={`${testId}-confirm`}
          >
            {confirmLabel}
          </DestructiveButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
