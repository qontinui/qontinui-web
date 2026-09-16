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
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { selfDecidedOrUnknown } from "../_lib/authorship";
import { formatWhen } from "../_lib/format";
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
 * `proposal-reject`, `proposal-approve`. `proposal-decided-by` was added by
 * plan `2026-09-13-policy-proposals-agent-decidable-dial-driven-self-retiring`
 * Phase 4 and carries `data-self-decided`, the machine-readable half of the
 * author-decided line — TRI-STATE (`true` / `false` / `unknown`), so "coord
 * says somebody else decided it" and "we cannot tell" stay different answers.
 * `proposal-self-decided` is the line itself; `proposal-closed` replaces the
 * decision composer on a row coord has already closed.
 *
 * ## This card renders DECIDED rows too
 *
 * It used to see nothing but `?status=pending`, which made the provenance
 * block's decided half unreachable: coord filters the list by status, so every
 * row that reached here had `decided_by: null`. `ReviewFeed`'s "Recently
 * approved" section now feeds approved rows through this same component, which
 * is what gives the self-decided line — the compensating audit control for
 * ownership no longer gating a decision — a surface it can actually appear on.
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

  /*
   * Stale = the document moved since the edit was authored, so the wording this
   * proposal assumed is no longer what is deployed.
   *
   * coord's TERMINAL retirement is excluded deliberately. The warning panel
   * below tells the reader to re-read the document *before approving*, and a
   * retired proposal cannot be approved by anyone — repeating an instruction
   * about an action that no longer exists is noise, and the row's own badge
   * already says `retired` (`../proposalStatus.ts`).
   */
  const stale =
    proposal.status !== "stale" &&
    liveVersion !== null &&
    liveVersion > proposal.base_version;

  /*
   * INFORMATION, not a warning — and the audit affordance that REPLACED a rule.
   *
   * Ownership stopped being a criterion for deciding a proposal, and
   * `self_decided` plus a required decision note is the compensating control
   * that took its place. A loosening approved by its own author is therefore a
   * permitted outcome the console has to be able to SHOW — a control that is
   * stored but never surfaced is not a control. So the line is given weight
   * (its own row, the fact in `font-medium` foreground rather than buried
   * mid-sentence) while staying in the page's calm chrome: no red, no amber, no
   * alert icon. Styling it as a caution would re-assert by design exactly the
   * ownership rule the fleet deliberately removed.
   *
   * `selfDecidedOrUnknown` owns the precedence (coord's `self_decided` over the
   * string comparison) and keeps UNKNOWN distinct from `false`. The text only
   * speaks for `true`; the tri-state travels in `data-self-decided`.
   */
  const selfDecidedVerdict = selfDecidedOrUnknown(proposal);
  const selfDecided = selfDecidedVerdict === true;

  /*
   * The composer is offered only on a row that can still be decided.
   *
   * Defence in depth, not the enforcement: coord refuses a decision on a closed
   * proposal server-side, and it is the authority. But the card already reasons
   * this way one block up — the pre-approval staleness warning is dropped on a
   * retired row because "repeating an instruction about an action that no
   * longer exists is noise" — and leaving two enabled buttons under that same
   * argument offers the action while the text says it is impossible. Now that
   * decided rows reach this card through the "Recently approved" section, that
   * is a live state rather than a hypothetical one.
   */
  const decidable = proposal.status === "pending";

  return (
    <RecordRow
      data-testid={`proposal-${proposal.id}`}
      rowKey={proposal.id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
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
          !decidable ? (
            <p
              className="border-t border-border pt-3 text-xs text-muted-foreground"
              data-testid="proposal-closed"
            >
              coord closed this; no decision is possible.
            </p>
          ) : (
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
          )
        }
        history={
          <div className="space-y-1">
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
            {proposal.decided_by && (
              <div
                className="whitespace-pre-wrap break-words text-xs text-muted-foreground"
                data-testid="proposal-decided-by"
                /*
                 * TRI-STATE, deliberately. `"false"` is an assertion — coord
                 * answered and the decider was somebody else — so it is not
                 * also spent on "we could not tell", which is what
                 * `"unknown"` is for (no `self_decided` flag and a blank on one
                 * of the two identities). The rendered text below speaks only
                 * for `true`; this attribute is the channel a UI-Bridge or
                 * spec-CI assertion reads, and it is the one that has to keep
                 * absence and zero apart.
                 */
                data-self-decided={
                  selfDecidedVerdict === null
                    ? "unknown"
                    : selfDecidedVerdict
                      ? "true"
                      : "false"
                }
              >
                <p>
                  Decided by{" "}
                  <span className="font-medium text-foreground">
                    {proposal.decided_by}
                  </span>
                  {proposal.decided_at
                    ? ` · ${formatWhen(proposal.decided_at)}`
                    : ""}
                  {proposal.decision_note ? ` · ${proposal.decision_note}` : ""}
                </p>
                {selfDecided && (
                  <p
                    className="mt-1 border-l-2 border-border pl-2 font-medium text-foreground"
                    data-testid="proposal-self-decided"
                  >
                    Decided by its author — the proposer approved or rejected
                    its own edit.
                  </p>
                )}
              </div>
            )}
          </div>
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
