"use client";

import { AlertTriangle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { cn } from "@/lib/utils";
import { formatWhen } from "../_lib/format";
import type { PromptDocumentWrite } from "../types";

interface LandedWriteFeedProps {
  writes: PromptDocumentWrite[];
  /**
   * Every caveat that applies — unreadable, degraded, partial, truncated. They
   * are independent conditions and can co-occur, so all of them are shown.
   */
  notices: string[];
  /** True when a caveat means coord is actually failing, not just incomplete. */
  severe: boolean;
  loading: boolean;
  acting: boolean;
  onRevert: (write: PromptDocumentWrite) => Promise<boolean>;
}

/**
 * Recently landed prompt-document writes, newest first, each revertible in one
 * click.
 *
 * These are the edits that DID land — additive clauses and tier-raising changes,
 * which need no review by construction. The queue above holds the ones that
 * didn't. Seeing both on one page is the point: the review surface should show
 * what happened as well as what is waiting.
 *
 * Undo appends a new version restoring the PREVIOUS body; it never rewrites
 * history, so an undo is itself undoable. Only the version that is currently
 * head gets the control — undoing an older-than-head write from a flat feed
 * would silently discard every write made since, so those rows show their
 * version and nothing more.
 */
export function LandedWriteFeed({
  writes,
  notices,
  severe,
  loading,
  acting,
  onRevert,
}: LandedWriteFeedProps) {
  return (
    <section className="space-y-3" data-testid="landed-writes">
      <div>
        <h2 className="text-sm font-semibold">Recently landed writes</h2>
        <p className="text-xs text-muted-foreground">
          Edits that went straight in — additive clauses and changes that
          tighten rather than loosen. Every one is a new version, so undoing the
          latest is one click and is itself undoable.
        </p>
      </div>

      {/* Coord genuinely failing gets the amber treatment; "incomplete but
          working" (degraded / partial / truncated) stays muted. */}
      {notices.length > 0 && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2.5",
            severe
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-border bg-muted/50"
          )}
          data-testid="landed-writes-notice"
        >
          <AlertTriangle
            className={cn(
              "mt-0.5 size-4 shrink-0",
              severe
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}
          />
          <div
            className={cn(
              "space-y-1 text-sm",
              severe
                ? "text-amber-800 dark:text-amber-200"
                : "text-muted-foreground"
            )}
          >
            {notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
          </div>
        </div>
      )}

      {loading && writes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading recent writes…
        </p>
      ) : writes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {notices.length > 0
              ? "No writes could be read — see the note above."
              : "No document writes recorded yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {writes.map((write) => {
            const isHead = write.version_number === write.current_version;
            return (
              <li
                key={`${write.kind}/${write.name}/${write.version_number}`}
                className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                data-testid={`write-${write.kind}-${write.name}-${write.version_number}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {write.label}
                    </span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      v{write.version_number}
                      {isHead ? " · current" : ""}
                    </code>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {write.edited_by ?? "unknown author"} ·{" "}
                    {formatWhen(write.created_at)}
                  </p>
                  {write.change_note && (
                    <p className="truncate text-xs italic text-muted-foreground">
                      {write.change_note}
                    </p>
                  )}
                </div>

                {isHead && write.version_number > 1 && (
                  <CoordAdminOnly
                    fallback={<ReadOnlyNotice label="Admin only" />}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={acting}
                      onClick={() => onRevert(write)}
                      title={`Restore the wording from v${write.version_number - 1}`}
                      data-testid={`revert-${write.kind}-${write.name}`}
                    >
                      <Undo2 className="size-4" />
                      Undo
                    </Button>
                  </CoordAdminOnly>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
