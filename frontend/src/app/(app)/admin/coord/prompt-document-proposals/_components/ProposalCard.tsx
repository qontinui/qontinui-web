"use client";

import { useState } from "react";
import { ArrowRight, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { formatWhen } from "../_lib/format";
import { DIRECTION_META, TIER_DESCRIPTIONS } from "../types";
import type { PromptDocumentProposal, ProposalTier } from "../types";

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
 */
export function ProposalCard({
  proposal,
  liveVersion,
  loading,
  acting,
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

  // Stale = the document moved since the edit was authored, so the wording this
  // proposal assumed is no longer what is deployed.
  const stale = liveVersion !== null && liveVersion > proposal.base_version;

  return (
    <article
      className="space-y-3 rounded-lg border border-border bg-card px-4 py-3.5"
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.variant} data-testid="proposal-direction">
          {meta.label}
        </Badge>
        <span className="truncate text-sm font-medium">
          {proposal.doc_name}
        </span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {proposal.doc_kind}
        </code>
        {proposal.clause_id && (
          <code
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title="The clause this edit alters"
          >
            {proposal.clause_id}
          </code>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{meta.explanation}</p>

      {(proposal.from_tier || proposal.to_tier) && (
        <div
          className="flex flex-wrap items-center gap-2 text-xs"
          data-testid="proposal-tier-change"
        >
          <span className="text-muted-foreground">Autonomy tier</span>
          <TierChip tier={proposal.from_tier} />
          <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
          <TierChip tier={proposal.to_tier} />
          {proposal.to_tier && (
            <span className="text-muted-foreground">
              {TIER_DESCRIPTIONS[proposal.to_tier]}
            </span>
          )}
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

      <p className="text-xs text-muted-foreground">
        Proposed by{" "}
        <span className="font-medium text-foreground">
          {proposal.proposed_by}
        </span>{" "}
        · {formatWhen(proposal.created_at)} · authored against v
        {proposal.base_version}
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

      {stale && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="proposal-stale"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            The document has changed since this was written (now v{liveVersion},
            authored against v{proposal.base_version}). Read the current wording
            before approving — the change this proposal assumed may already be
            gone or superseded.
          </p>
        </div>
      )}

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
    </article>
  );
}
