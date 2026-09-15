"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CollapsiblePanel, RecordList } from "@/components/console";
import { usePromptDocumentProposals } from "../_hooks/usePromptDocumentProposals";
import { formatWhen, plural } from "../_lib/format";
import { isUnavailableSevere } from "../types";
import type { PromptDocumentProposal } from "../types";
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
 *
 * Below the queue sits the RETIRED section — proposals coord closed itself when
 * their target document moved (plan
 * `2026-09-13-policy-proposals-agent-decidable-dial-driven-self-retiring`,
 * Phase 4). It exists so a retirement is VISIBLE rather than a row silently
 * disappearing from the queue between two refreshes, and it repeats the same
 * three-state honesty one level down: populated, "none retired recently", and
 * UNKNOWN when the read failed [policy `verification-and-evidence`
 * `silent-empty-is-unknown`; `ux-priorities` — honesty about uncertainty /
 * no-surprise].
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
    staleProposals,
    staleUnavailable,
    staleRead,
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
    withdrawWrite,
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

      <RetiredProposals
        retired={staleProposals}
        unavailable={staleUnavailable}
        read={staleRead}
      />

      <LandedWriteFeed
        writes={writes}
        notices={writesNotices}
        severe={writesSevere}
        nothingRead={writesNothingRead}
        loading={loading}
        acting={acting}
        onRevert={revertWrite}
        onWithdraw={withdrawWrite}
        onLoadDiff={loadWriteDiff}
        diffFor={writeDiffFor}
      />
    </div>
  );
}

interface RetiredProposalsProps {
  /** The rows coord served for `?status=stale`. Empty is only "none" when `read`. */
  retired: PromptDocumentProposal[];
  /** Why the read failed, or `null` when it succeeded. Non-null ⇒ UNKNOWN. */
  unavailable: string | null;
  /** Has the read completed at all? Before it has, the section knows nothing. */
  read: boolean;
}

/**
 * "Retired as stale" — the proposals coord closed itself.
 *
 * ## Why this section exists at all
 *
 * coord retires a pending proposal inside the transaction that bumps its target
 * document's version. Without a surface for the result, the operator's
 * experience of that is a row that was in the queue on one refresh and gone on
 * the next, with nothing anywhere saying what happened to it — a proposal
 * appearing to have been decided by nobody. The section is the receipt.
 *
 * ## Collapsed, but its signal is not
 *
 * R7. Closed by default because a retirement asks nothing of anyone; the header
 * summary carries the state whether or not the panel is open, so the one thing
 * that must not hide behind a click — *we could not read this* — never does.
 * `<CollapsibleContent>` unmounts its children when closed, which is exactly
 * why the summary and not the body is where the state is stated.
 *
 * ## Three states, and the one that is easy to get wrong
 *
 * * populated — a count, and per row the target document, the version it was
 *   written against, coord's decision note and when it was decided;
 * * empty — "none retired recently", a claim only made after a read that
 *   actually succeeded;
 * * unreadable — UNKNOWN, never empty. An older coord answers `?status=stale`
 *   with `400 invalid status` and a section that rendered that as "none
 *   retired recently" would be asserting something it does not know
 *   [`verification-and-evidence` `silent-empty-is-unknown`].
 *
 * Nothing here is styled as an alarm. A retirement is a closed record, and the
 * unreadable arm is a routine deploy window — both are stated in muted chrome,
 * in words.
 */
function RetiredProposals({
  retired,
  unavailable,
  read,
}: RetiredProposalsProps) {
  const summary = unavailable
    ? "could not be read"
    : !read
      ? "reading…"
      : retired.length === 0
        ? "none retired recently"
        : plural(retired.length, "proposal");

  return (
    <CollapsiblePanel
      title="Retired as stale"
      summary={
        <span
          className="text-xs font-normal normal-case tracking-normal text-muted-foreground"
          data-testid="retired-summary"
        >
          {summary}
        </span>
      }
      defaultOpen={false}
      storageKey="coord.proposals.retired-stale"
      data-testid="retired-proposals"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        coord closes a proposal the moment its target document moves past the
        version the edit was written against — in the same write, so it cannot
        be approved afterwards. These are listed here rather than left to vanish
        from the queue. Re-read the current document and propose again if the
        change is still wanted.
      </p>

      {unavailable ? (
        <div
          className="rounded-md border border-border bg-muted/50 px-3 py-2.5"
          data-testid="retired-unknown"
        >
          <p className="text-sm text-muted-foreground">
            Retired proposals could not be read, so this section is unknown —
            not empty. {unavailable}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Expected while coord is older than this page: it does not recognise
            the retired status yet and refuses the query. Nothing above is
            affected.
          </p>
        </div>
      ) : !read ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Reading retired proposals…
        </p>
      ) : retired.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-border py-8 text-center"
          data-testid="retired-empty"
        >
          <p className="text-sm text-muted-foreground">none retired recently</p>
        </div>
      ) : (
        <RecordList
          items={retired}
          itemKey={(p) => p.id}
          empty={null}
          renderRow={(proposal) => (
            <div
              className="space-y-1 border-b border-border/60 px-1 py-2.5 last:border-b-0"
              data-testid={`retired-proposal-${proposal.id}`}
            >
              <p className="text-sm">
                <span className="text-muted-foreground">
                  {proposal.doc_kind}/
                </span>
                <span className="font-medium">{proposal.doc_name}</span>
                {proposal.clause_id && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {proposal.clause_id}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {" "}
                  · written against v{proposal.base_version}
                </span>
              </p>
              <p
                className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
                data-testid="retired-decision-note"
              >
                {proposal.decision_note || (
                  <span className="italic">
                    coord recorded no note with this retirement
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {proposal.decided_at
                  ? `Retired ${formatWhen(proposal.decided_at)}`
                  : "Retirement time not reported by coord"}
              </p>
            </div>
          )}
        />
      )}
    </CollapsiblePanel>
  );
}
