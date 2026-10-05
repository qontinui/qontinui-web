"use client";

/**
 * Somebody else saved while you were editing. Show both versions and let the
 * writer decide — never silently keep either (plan
 * `2026-09-20-overview-authoring-layer` §1, "Conflict").
 *
 * - **Keep mine** saves your text over theirs, now knowingly.
 * - **Take theirs** discards your text.
 * - **Merge** returns you to the editor with your text, and theirs shown
 *   beside it, so you can bring over what you want before saving.
 *
 * When keeping mine cannot be done safely as it stands (`keepMineBlocked`),
 * that choice is absent and the dialog says why: the writer combines.
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
import { formatRelativeTime } from "@/lib/time-utils";

export function ConflictDialog({
  open,
  mine,
  theirs,
  theirsBy,
  theirsAt,
  onKeepMine,
  onTakeTheirs,
  onMerge,
  keepMineBlocked = [],
  uiBridgeId,
}: {
  open: boolean;
  mine: string;
  theirs: string;
  theirsBy: string | null;
  theirsAt: string | null;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onMerge: () => void;
  /** Why "keep mine" would lose or break something; non-empty hides it. */
  keepMineBlocked?: string[];
  uiBridgeId: string;
}) {
  const who = theirsBy ?? "Somebody";
  const when = theirsAt ? formatRelativeTime(theirsAt) : null;
  return (
    // Closing without a choice is "Merge": nothing is lost, and the writer is
    // back in the editor with both texts in view.
    <Dialog open={open} onOpenChange={(next) => !next && onMerge()}>
      <DialogContent
        className="max-h-[90vh] max-w-4xl overflow-y-auto"
        data-ui-bridge-id={uiBridgeId}
      >
        <DialogHeader>
          <DialogTitle>
            Somebody else changed this while you were editing
          </DialogTitle>
          <DialogDescription>
            {who} saved a new version{when ? ` ${when}` : ""}. Nothing has been
            overwritten. Choose which to keep.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <section aria-label="Their version">
            <h3 className="mb-1 text-sm font-medium text-foreground">
              Their version
            </h3>
            <pre
              className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed"
              data-ui-bridge-id={`${uiBridgeId}.theirs`}
            >
              {theirs}
            </pre>
          </section>
          <section aria-label="Your version">
            <h3 className="mb-1 text-sm font-medium text-foreground">
              Your version
            </h3>
            <pre
              className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 text-xs leading-relaxed"
              data-ui-bridge-id={`${uiBridgeId}.mine`}
            >
              {mine}
            </pre>
          </section>
        </div>
        {keepMineBlocked.length > 0 && (
          <div
            role="note"
            className="rounded-md border border-destructive/40 p-3 text-sm"
            data-ui-bridge-id={`${uiBridgeId}.blocked`}
          >
            <p className="font-medium text-foreground">
              Yours can&rsquo;t simply be saved over theirs, so combine them:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {keepMineBlocked.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={onTakeTheirs}
            data-ui-bridge-id={`${uiBridgeId}.take-theirs`}
          >
            Discard mine, keep theirs
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={onMerge}
              data-ui-bridge-id={`${uiBridgeId}.merge`}
            >
              Combine them myself
            </Button>
            {keepMineBlocked.length === 0 && (
              <Button
                onClick={onKeepMine}
                data-ui-bridge-id={`${uiBridgeId}.keep-mine`}
              >
                Save mine over theirs
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
