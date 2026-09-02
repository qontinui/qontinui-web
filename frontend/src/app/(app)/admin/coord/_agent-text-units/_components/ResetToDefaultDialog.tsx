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
import type { UnitFiles } from "@/lib/api/agent-text-units";
import type { WritableLayer } from "../types";

interface ResetToDefaultDialogProps {
  unitName: string;
  layer: WritableLayer;
  /** What applies once this layer's row is gone — named, not guessed. */
  fallsBackTo: string;
  /** The stored files, offered for copying before they are destroyed. */
  currentFiles: UnitFiles;
  versionCount: number;
  busy: boolean;
  onConfirm: () => void;
}

/** One clipboard payload for a whole unit: every file, path-delimited, in
 *  sorted order. A `files` map has no single body to copy, so copying "the
 *  body" would quietly drop the siblings that make a skill work. */
function serializeFiles(files: UnitFiles): string {
  return Object.keys(files)
    .sort()
    .map((path) => `===== ${path} =====\n${files[path]}`)
    .join("\n\n");
}

/**
 * Confirmation for deleting ONE LAYER's row — i.e.
 * `DELETE /agent-text-units/{name}`.
 *
 * The wording is checked against what the backend actually does. Deleting a
 * unit cascades its version chain
 * (`AgentTextUnitVersion.agent_text_unit_id` is `ondelete="CASCADE"`, and the
 * ORM relationship is `cascade="all, delete-orphan"`), so this is NOT a
 * "reversible via version history" reset — the history goes with the row and
 * cannot be restored from this app.
 *
 * So the dialog states the loss plainly and makes the reversibility real
 * instead of implied: it offers to copy every file first, which is what
 * actually lets the operator put the layer back.
 *
 * A **fleet** deletion is the wide one — it removes the text every account
 * without an override of its own was resolving — so the dialog says which
 * layer is going and what applies afterwards.
 */
export function ResetToDefaultDialog({
  unitName,
  layer,
  fallsBackTo,
  currentFiles,
  versionCount,
  busy,
  onConfirm,
}: ResetToDefaultDialogProps) {
  const [copied, setCopied] = useState(false);
  const fileCount = Object.keys(currentFiles).length;
  const layerNoun = layer === "fleet" ? "fleet default" : "account override";

  const copyFiles = async () => {
    try {
      await navigator.clipboard.writeText(serializeFiles(currentFiles));
      setCopied(true);
      toast.success(
        `Copied all ${fileCount} file${fileCount === 1 ? "" : "s"} to the clipboard.`
      );
    } catch {
      setCopied(false);
      toast.error(
        "Could not access the clipboard — select the text in the editor and copy it manually."
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
          data-testid="unit-delete-btn"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Undo2 className="size-3.5" />
          )}
          Delete {layerNoun}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="unit-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete the {layerNoun} for {unitName}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Newly spawned sessions will resolve {fallsBackTo} instead.
                Sessions that are already running received their copy when they
                started and are not affected.
              </p>
              {layer === "fleet" && (
                <p className="font-medium text-destructive">
                  This is the fleet layer: every account that has not overridden{" "}
                  {unitName} is currently served this text, and all of them stop
                  being served it.
                </p>
              )}
              <p className="font-medium text-destructive">
                This also deletes the {versionCount} stored version
                {versionCount === 1 ? "" : "s"} of this layer. Version history is
                removed along with the row — it is not archived, and it cannot
                be recovered from this app afterwards.
              </p>
              <p>
                What makes this reversible is your own copy: recreate the unit
                and paste the files back. Copy them now if you might want them.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void copyFiles()}
            data-testid="unit-delete-copy"
          >
            <Copy className="size-3.5" />
            {copied
              ? "Copied"
              : `Copy all ${fileCount} file${fileCount === 1 ? "" : "s"}`}
          </button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="unit-delete-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="unit-delete-confirm"
          >
            Delete {layerNoun} and history
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
