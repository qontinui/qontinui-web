"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordList } from "@/components/console";
import { cn } from "@/lib/utils";
import { usePromptDocumentProposals } from "../_hooks/usePromptDocumentProposals";
import { isUnavailableSevere } from "../types";
import { LandedWriteFeed } from "./LandedWriteFeed";
import { ProposalCard } from "./ProposalCard";

/**
 * The two halves of the operator review surface, over one shared data layer:
 * the pending policy-edit proposal queue, then the recently landed writes.
 *
 * Order is deliberate — proposals first, because they are the only half that is
 * waiting on a person. The landed feed is context and undo, not a task list.
 *
 * Three not-good states are rendered as three distinct things and never
 * collapsed into an empty queue:
 *   • `error`       — the request failed; we know nothing, and the last-good
 *                     queue stays on screen marked as possibly stale.
 *   • `unavailable` — coord answered, but has no proposal surface yet (the
 *                     window before its Phase 5 half deploys). An empty list
 *                     here means "cannot see", not "nothing pending".
 *   • genuinely empty — the only case that gets a reassuring message.
 */
export function ReviewFeed() {
  /**
   * The open proposal (R5 — one at a time). Hoisted out of `<RecordList>`
   * rather than left internal because a decision REMOVES the row it was taken
   * on, and an internal key would then point at nothing with no way for this
   * component to clear it.
   */
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const {
    proposals,
    writes,
    loading,
    acting,
    error,
    unavailable,
    unavailableKind,
    writesNotices,
    writesSevere,
    writesNothingRead,
    liveVersionFor,
    loadWriteDiff,
    writeDiffFor,
    reload,
    decide,
    revertWrite,
  } = usePromptDocumentProposals();

  // A pre-deploy 404 is expected and benign. An UNLABELLED unavailable is also
  // treated as benign here (fallback `false`): the frontend and backend deploy
  // independently, so "new page, older backend that doesn't send the kind yet"
  // is a routine window, and shouting in it is the false alarm this field
  // exists to avoid. The write feed makes the opposite call, for the reason
  // documented on `isUnavailableSevere`.
  const unavailableSevere = isUnavailableSevere(unavailableKind, false);

  const initialLoading =
    loading && proposals.length === 0 && writes.length === 0;
  const trulyEmpty =
    !initialLoading && !error && !unavailable && proposals.length === 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3" data-testid="proposal-queue">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              Pending proposals
              {proposals.length > 0 ? ` (${proposals.length})` : ""}
            </h2>
            <p className="text-xs text-muted-foreground">
              Edits agents wanted to make that would give agents more latitude —
              held here instead of landing. Nothing is blocked while these wait;
              the edit simply hasn&apos;t been applied.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={reload}
            disabled={loading}
            data-testid="review-feed-refresh"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        {initialLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading review feed…
          </p>
        )}

        {/* The request failed — we know nothing about the queue. */}
        {error && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
            data-testid="proposals-error"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Couldn&apos;t load the proposal queue: {error}.{" "}
              {proposals.length > 0
                ? "Showing the last queue loaded — it may be out of date."
                : "Nothing could be read, which is not the same as nothing being pending."}
            </p>
          </div>
        )}

        {/* Coord answered, but its Phase 5 proposal surface isn't deployed —
            or coord is genuinely down, which is styled as the louder case. */}
        {unavailable && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2.5",
              unavailableSevere
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-border bg-muted/50"
            )}
            data-testid="proposals-unavailable"
          >
            <AlertTriangle
              className={cn(
                "mt-0.5 size-4 shrink-0",
                unavailableSevere
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}
            />
            <p
              className={cn(
                "text-sm",
                unavailableSevere
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-muted-foreground"
              )}
            >
              {unavailable}
            </p>
          </div>
        )}

        {trulyEmpty ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No proposals waiting. Every agent edit so far either landed or was
              already decided.
            </p>
          </div>
        ) : (
          // R2/R5 — one proposal is one line, and its seven blocks plus the
          // decision composer expand in place. The empty node is deliberately
          // `null`: the three not-good states above already say which question
          // came back empty, and `trulyEmpty` is handled by the branch beside
          // this one, so a second empty state here would be a fourth voice
          // saying a fifth thing.
          <RecordList
            items={proposals}
            itemKey={(p) => p.id}
            expandedKey={openProposal}
            onExpandedKeyChange={setOpenProposal}
            empty={null}
            renderRow={(proposal, ctx) => (
              <ProposalCard
                proposal={proposal}
                liveVersion={liveVersionFor(
                  proposal.doc_kind,
                  proposal.doc_name
                )}
                loading={loading}
                acting={acting}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
                onDecide={decide}
              />
            )}
          />
        )}
      </section>

      <LandedWriteFeed
        writes={writes}
        notices={writesNotices}
        severe={writesSevere}
        nothingRead={writesNothingRead}
        loading={loading}
        acting={acting}
        onRevert={revertWrite}
        onLoadDiff={loadWriteDiff}
        diffFor={writeDiffFor}
      />
    </div>
  );
}
