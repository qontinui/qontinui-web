"use client";

import { useState } from "react";
import { Copy, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ResetToDefaultDialogProps {
  commandName: string;
  /** The stored body, offered for copying before it is destroyed. */
  currentBody: string;
  versionCount: number;
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Confirmation for "Reset to default" — i.e. `DELETE /agent-commands/{name}`.
 *
 * The wording is checked against what the backend actually does. Deleting the
 * override cascades the version chain
 * (`AgentCommandVersion.agent_command_id` is `ondelete="CASCADE"`, and the ORM
 * relationship is `cascade="all, delete-orphan"`), so this is NOT the
 * "reversible via version history" reset the plan sketched — the history goes
 * with the override and cannot be restored from this app.
 *
 * So the dialog states the loss plainly and makes the reversibility real
 * instead of implied: it offers to copy the current body to the clipboard
 * first, which is what actually lets the user put the override back.
 */
export function ResetToDefaultDialog({
  commandName,
  currentBody,
  versionCount,
  busy,
  onConfirm,
}: ResetToDefaultDialogProps) {
  const [copied, setCopied] = useState(false);

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(currentBody);
      setCopied(true);
      toast.success("Current body copied to the clipboard.");
    } catch {
      setCopied(false);
      toast.error(
        "Could not access the clipboard — select the body in the editor and copy it manually."
      );
    }
  };

  return (
    <AlertDialog onOpenChange={(open) => !open && setCopied(false)}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="btn-destructive btn-sm"
          disabled={busy}
          data-testid="agent-command-reset-btn"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Undo2 className="size-3.5" />
          )}
          Reset to default
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="agent-command-reset-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete your /{commandName} override?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Newly spawned sessions will go back to the copy embedded in the
                runner. Sessions that are already running keep the body they
                started with and are not affected.
              </p>
              <p className="font-medium text-destructive">
                This also deletes the {versionCount}{" "}
                stored version{versionCount === 1 ? "" : "s"} of this command.
                Version history is removed along with the override — it is not
                archived, and it cannot be recovered from this app afterwards.
              </p>
              <p>
                What makes this reversible is your own copy: customize the
                command again and paste the body back. Copy it now if you might
                want it.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void copyBody()}
            data-testid="agent-command-reset-copy"
          >
            <Copy className="size-3.5" />
            {copied ? "Copied" : "Copy current body"}
          </button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="agent-command-reset-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="agent-command-reset-confirm"
          >
            Delete override and history
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
