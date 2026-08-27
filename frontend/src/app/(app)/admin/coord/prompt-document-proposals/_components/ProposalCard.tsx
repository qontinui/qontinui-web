"use client";

import { useState } from "react";
import { ArrowRight, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { DIRECTION_META, TIER_DESCRIPTIONS } from "../types";
import type { PromptDocumentProposal, ProposalTier } from "../types";
import {
  PROPOSAL_STATUS_PALETTE,
  deriveProposalStatus,
} from "../proposalStatus";

interface ProposalCardProps {
  proposal: PromptDocumentProposal;
  /**
   * The target document's live `current_version`, or `null` when it could not
   * be resolved. `null` renders as unknown — never as "up to date".
   */
  liveVersion: number | null;
  /** True while a load is in flight — suppresses "could not be read" claims. */
  loading: boolean;
  acting: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDecide: (
    proposal: PromptDocumentProposal,
    action: "approve" | "reject",
    decisionNote: string
  ) => Promise<boolean>;
}

/** Tier token + its plain-language gloss, or an em dash when unset. */
function TierChip({ tier }: { tier: ProposalTier | null }) {
  if (!tier) return <span className="text-muted-foreground">—</span>;
  return (
    <code
      className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
      title={TIER_DESCRIPTIONS[tier]}
    >
      {tier}
    </code>
  );
}

/**
 * One pending policy-edit proposal: what document and clause it targets, which
 * way the comparator judged it, the proposed text, who authored it and why, and
 * approve/reject with an optional note.
 *
 * Reversibility framing: approving APPLIES the edit as a new document version
 * (revertible from the landed-write feed below); rejecting applies nothing.
 * Leaving it pending is a safe steady state — this is a queue, not a gate — so
 * neither button is the "default" action and neither is pre-selected.
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` moved this
 * onto `<RecordRow>` / `<RecordDetail>`. It was that plan's Family-B VARIANT
 * (§4 census correction): a hand-rolled fat card, not a shadcn `<Card>`, which
 * is why a `<Card>`-keyed audit missed it. It carried SEVEN stacked blocks —
 * direction badge line, explanation, tier change, proposed text, rationale,
 * provenance, staleness warning — plus a decision composer, before the next
 * proposal started. A queue you have to scroll to count is a queue you cannot
 * triage.
 *
 * All seven blocks survive; they moved into the detail's slots, which the
 * click earns. The R3 palette correction this carries is documented in
 * `../proposalStatus.ts` — in short, `unclassifiable` was RED and `loosening`
 * was AMBER on a queue whose own module doc says nothing waits on it, while
 * the one thing that genuinely does decay (staleness) was a note inside the
 * card rather than the row's state.
 *
 * Every authored `data-testid` is carried across unchanged (D4a):
 * `proposal-<id>`, `proposal-direction`, `proposal-tier-change`,
 * `proposal-content`, `proposal-stale`, `proposal-decision-note`,
 * `proposal-reject`, `proposal-approve`.
 */
export function ProposalCard({
  proposal,
  liveVersion,
  loading,
  acting,
  expanded,
  onToggle,
  onDecide,
}: ProposalCardProps) {
  const [note, setNote] = useState("");
  const meta = DIRECTION_META[proposal.direction] ?? {
    // An unknown direction is coord vocabulary this build predates. Show the
    // raw token loudly rather than silently rendering it as benign.
    label: proposal.direction,
    variant: "destructive" as const,
    explanation:
      "This build does not recognise the direction coord assigned. Treat it as at least as serious as a loosening edit.",
  };
  const status = deriveProposalStatus(proposal, liveVersion);

  // Stale = the document moved since the edit was authored, so the wording this
  // proposal assumed is no longer what is deployed.
  const stale = liveVersion !== null && liveVersion > proposal.base_version;

  return (
    <RecordRow
      data-testid={`proposal-${proposal.id}`}
      rowKey={proposal.id}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      identity={proposal.doc_kind}
      label={
        <span title={`${proposal.doc_kind}/${proposal.doc_name}`}>
          <span className="font-medium">{proposal.doc_name}</span>
          {proposal.clause_id && (
            <span className="text-muted-foreground"> · {proposal.clause_id}</span>
          )}
        </span>
      }
      status={
        // Wrapped rather than replaced: `proposal-direction` is the frozen
        // authored testid for "which way did the comparator judge this", and
        // `<StatusBadge>` — correctly — exposes no such attribute. The badge
        // reports the ROW's kind, which is the same thing except when
        // staleness overrides it; the raw direction stays readable in
        // `data-direction` and in the detail's `why` slot either way.
        <span
          className="inline-flex shrink-0"
          data-testid="proposal-direction"
          data-direction={proposal.direction}
        >
          <StatusBadge status={status} palette={PROPOSAL_STATUS_PALETTE} />
        </span>
      }
      reason={status.reason}
      time={<RowTime at={proposal.created_at} verb="Proposed" />}
    >
      <RecordDetail
        why={
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{meta.explanation}</p>
            {(proposal.from_tier || proposal.to_tier) && (
              <div
                className="flex flex-wrap items-center gap-2 text-xs"
                data-testid="proposal-tier-change"
              >
                <span className="text-muted-foreground">Autonomy tier</span>
                <TierChip tier={proposal.from_tier} />
                <ArrowRight
                  className="size-3 text-muted-foreground"
                  aria-hidden
                />
                <TierChip tier={proposal.to_tier} />
                {proposal.to_tier && (
                  <span className="text-muted-foreground">
                    {TIER_DESCRIPTIONS[proposal.to_tier]}
                  </span>
                )}
              </div>
            )}
          </div>
        }
        problems={
          <div className="space-y-3">
            {stale && (
              /*
               * RED, matching the badge — not the amber this block used to be.
               *
               * Both are rendered from the SAME predicate (`liveVersion >
               * base_version`), so an amber box under a red badge had the row
               * saying two things at once: "someone must act now" and "waiting
               * on something else, it will clear itself". That is the exact
               * failure `../proposalStatus.ts` argues against one level down,
               * where staleness is a KIND rather than an escalation for
               * precisely this reason — one badge, one claim. The amber was
               * pre-existing and correct while the badge was calm; the red
               * badge is what made it wrong, so it is this diff's to fix.
               */
              <div
                className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2"
                data-testid="proposal-stale"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                <p className="text-xs text-red-800 dark:text-red-200">
                  The document has changed since this was written (now v
                  {liveVersion}, authored against v{proposal.base_version}).
                  Read the current wording before approving — the change this
                  proposal assumed may already be gone or superseded.
                </p>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Proposed text
              </p>
              <pre
                className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs"
                data-testid="proposal-content"
              >
                {proposal.proposed_content}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Why the author says it&apos;s needed
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {proposal.rationale || (
                  <span className="italic text-muted-foreground">
                    No rationale supplied.
                  </span>
                )}
              </p>
            </div>
          </div>
        }
        actions={
          <CoordAdminOnly
            fallback={
              <ReadOnlyNotice label="Only administrators can decide proposals" />
            }
          >
            <div className="space-y-2 border-t border-border pt-3">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor={`decision-note-${proposal.id}`}
              >
                Decision note (optional — recorded with your decision)
              </label>
              <Textarea
                id={`decision-note-${proposal.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Why you approved or rejected this."
                data-testid="proposal-decision-note"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={acting}
                  onClick={() => onDecide(proposal, "reject", note)}
                  data-testid="proposal-reject"
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={acting}
                  onClick={() => onDecide(proposal, "approve", note)}
                  data-testid="proposal-approve"
                >
                  <ShieldAlert className="size-4" />
                  Approve &amp; apply
                </Button>
              </div>
            </div>
          </CoordAdminOnly>
        }
        history={
          <p className="text-xs text-muted-foreground">
            Proposed by{" "}
            <span className="font-medium text-foreground">
              {proposal.proposed_by}
            </span>{" "}
            · authored against v{proposal.base_version}
            {/* A load in flight is not a failed lookup — say nothing until it
                settles rather than flashing "could not be read". */}
            {liveVersion === null
              ? loading
                ? ""
                : " · the document's current version could not be read"
              : liveVersion === proposal.base_version
                ? " · still the current version"
                : ""}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            proposal_id: {proposal.id} · direction: {proposal.direction} ·
            target: {proposal.doc_kind}/{proposal.doc_name}
            {proposal.clause_id ? ` · clause: ${proposal.clause_id}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
