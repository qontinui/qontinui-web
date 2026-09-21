"use client";

// ============================================================================
// Merge-train presentational pieces — rows and panels rendered by MergePipeline
// ============================================================================
//
// This module used to export a self-fetching `MergeTrain` panel as well. That
// panel was REPLACED by `MergePipeline` on 2026-07-15 (`946e06c7`, fleet-page
// redesign) and `useMergePipelineData` became the single data owner; the
// component body was left behind and stopped being rendered by anything. It
// was deleted on 2026-08-20 — with it went a second copy of the queue / PR /
// suggestions / gate-decisions fetches and a second WebSocket client, all
// unreachable. That duplicate copy was still being maintained: plan
// 2026-08-20-predicate-eval-surface-counts-evals-not-decisions Phase 2 edited
// BOTH `fetchGateBlocks` implementations, and only one of them could run.
//
// What remains is presentation only — no fetching, no state, no transport.
// Every export here is rendered by `MergePipeline`:
//
//   - `MergeTrainRow`       — one raw scheduler proposal (Coord internals)
//   - `SuggestionCard`      — one pending drift/audit suggestion
//   - `GateDecisionCounts`  — the gate-decision header counts
//   - `GateDecisionRow`     — one blast-radius gate decision, standalone
//   - `GateDecisionDetail`  — the same decision as EVIDENCE inside a PR's row
//
// Data for all five comes from `useMergePipelineData`; the pure derivation
// behind the last three lives in `gateDecision.ts` (R8).

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  ShieldQuestion,
} from "lucide-react";
import { AUTHOR_RED, WAITING_AMBER } from "@/components/console";
import { relativeTime } from "./utils";
import { redactSecrets } from "./mergeTypes";
import {
  gateFirstSeenDay,
  gateRepeatCount,
  honestyLabel,
  type HonestyTone,
} from "./gateDecision";
import type {
  BlastRadiusBlock,
  ProposalDetail,
  ProposalStatus,
  SuggestionRow,
} from "./mergeTypes";

// ----------------------------------------------------------------------------
// Status visual classification
// ----------------------------------------------------------------------------

function statusTint(status: ProposalStatus): string {
  switch (status) {
    case "merged":
      return "bg-green-500/15 text-green-200 border-green-500/30";
    case "landing":
      return "bg-blue-500/15 text-blue-200 border-blue-500/30";
    case "awaiting-ci":
      return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
    case "dry-rebasing":
      return "bg-purple-500/15 text-purple-200 border-purple-500/30";
    case "queued":
      return "bg-muted text-muted-foreground border-border";
    case "conflict":
    case "blocked-by-overlap":
      // Was a hand-spelled red carrying `border-red-500/30` where
      // `AUTHOR_RED` says `/35` — a live drift the prefix audit could not
      // see, and the reason the constants are imported rather than typed.
      return AUTHOR_RED;
    case "speculative-ci":
      // Candidate CI on a speculative tip stacked on an unlanded predecessor —
      // coord testing, same family as dry-rebasing, never red.
      return "bg-purple-500/15 text-purple-200 border-purple-500/30";
    case "shadow-landed":
    case "cancelled":
      // Terminal and inert. `shadow-landed` completed every phase but parked
      // instead of pushing (COORD_MERGE_DRY_LAND=1) — NOT a landing, so it must
      // not borrow `merged`'s green.
      return "bg-muted/40 text-muted-foreground border-border line-through";
    default:
      // `ProposalStatus` is a coord enum this frontend does not control; a
      // status added there must render inertly rather than emit
      // `class="… undefined"`.
      //
      // TRADE-OFF, stated because it is not free: with every member now
      // handled, this arm is unreachable per the type, so it PERMANENTLY gives
      // up the non-exhaustive-switch error — which is exactly the signal that
      // caught this file when `speculative-ci` and `shadow-landed` were added.
      // Runtime safety is worth more here than that compile-time tripwire,
      // but a new coord status will now land silently as grey.
      return "bg-muted text-muted-foreground border-border";
  }
}

// ----------------------------------------------------------------------------
// Row
// ----------------------------------------------------------------------------

export function MergeTrainRow({ proposal }: { proposal: ProposalDetail }) {
  const repoSummary = useMemo(() => {
    const first = proposal.repos[0];
    if (!first) return "—";
    if (proposal.repos.length === 1) {
      return `${first.repo} · ${first.branch}`;
    }
    return `${proposal.repos.length} repos`;
  }, [proposal.repos]);

  const ciLink = useMemo(() => {
    return proposal.repos.find((r) => r.ci_run_url)?.ci_run_url ?? null;
  }, [proposal.repos]);

  const agentShort = proposal.agent_id.slice(0, 8);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 border rounded-md transition-colors ${statusTint(
        proposal.status
      )}`}
      data-status={proposal.status}
      data-proposal-id={proposal.proposal_id}
    >
      <Badge variant="outline" className="font-mono text-xs">
        {agentShort}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{repoSummary}</p>
        {proposal.error && (
          <p className="text-xs text-red-300 flex items-center gap-1 mt-0.5">
            <AlertTriangle className="h-3 w-3" />
            {redactSecrets(proposal.error)}
          </p>
        )}
      </div>
      <Badge className="font-mono text-[10px] uppercase tracking-wide">
        {proposal.status}
      </Badge>
      {typeof proposal.requeue_count === "number" &&
        proposal.requeue_count > 0 && (
          <Badge
            variant="outline"
            className="font-mono text-[10px] tracking-wide bg-orange-500/15 text-orange-200 border-orange-500/30 flex items-center gap-1"
            title={`Requeued ${proposal.requeue_count}× by leader-takeover recovery — starvation signal`}
            data-requeue-count={proposal.requeue_count}
          >
            <RotateCcw className="h-3 w-3" />
            requeued &times;{proposal.requeue_count}
          </Badge>
        )}
      <span className="text-xs text-muted-foreground tabular-nums">
        {relativeTime(proposal.updated_at)}
      </span>
      {ciLink && (
        <a
          href={ciLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Open CI run"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

/** Build the GitHub PR URL from repo + pr_number. */
function prHref(repo: string, pr_number: number): string {
  return `https://github.com/${repo}/pull/${pr_number}`;
}

// ----------------------------------------------------------------------------
// Section
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// PR Merge Orchestrator Phase 8 D8.6 -- Suggestion card.
//
// One card per pending suggestion in the dashboard's Suggestions inbox.
// Renders rationale + supporting-overrides + Accept / Reject / Mute buttons.
// Submit POSTs to /pr-merge/suggestions/:alert_id/{accept,reject,mute}.
// ----------------------------------------------------------------------------

interface SuggestionCardProps {
  sug: SuggestionRow;
  busy: boolean;
  onAction: (
    alertId: number,
    action: "accept" | "reject" | "mute",
    body?: Record<string, unknown>
  ) => void;
}

export function SuggestionCard({ sug, busy, onAction }: SuggestionCardProps) {
  const subject = sug.detail.subject ?? sug.detail.repo ?? "";
  const rationale = sug.detail.rationale ?? sug.summary;
  const kindLabel =
    sug.kind === "profile_audit_stale"
      ? "AUDIT STALE"
      : (sug.detail.suggestion_kind?.replace(/_/g, " ").toUpperCase() ??
        "DRIFT");
  return (
    <div
      className="border border-blue-500/30 bg-blue-500/5 rounded-md p-3 space-y-2"
      data-suggestion-id={sug.alert_id}
      data-suggestion-kind={sug.detail.suggestion_kind ?? sug.kind}
    >
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="font-mono text-[10px] uppercase tracking-wide"
        >
          {kindLabel}
        </Badge>
        {subject && (
          <span className="text-xs text-muted-foreground font-mono truncate">
            {subject}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {relativeTime(sug.first_seen_at)}
        </span>
      </div>
      <p className="text-xs">{rationale}</p>
      {Array.isArray(sug.detail.supporting_overrides) &&
        sug.detail.supporting_overrides.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Supported by {sug.detail.supporting_overrides.length} override
            {sug.detail.supporting_overrides.length === 1 ? "" : "s"}.
          </p>
        )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          disabled={busy}
          onClick={() => onAction(sug.alert_id, "accept")}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onAction(sug.alert_id, "reject")}
        >
          Reject
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onAction(sug.alert_id, "mute", { days: 30 })}
        >
          Mute 30d
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Coordination-transparency — Gate decisions section
// ----------------------------------------------------------------------------
//
// Plan 2026-06-07-coordination-transparency-surfaces.md T2. Surfaces coord's
// blast-radius merge-gate DECISIONS (held PRs + reason + evidence + coverage)
// to the affected developer — the one thing the existing escalations/queue
// view omits. Reads `/operations/pr-merge/blast-radius-blocks` (proxied,
// tenant-scoped, any-member auth).
//
// Honesty rendering (binding cross-cutting gate): a degraded decision is NEVER
// presented as authoritative. The derivation is `gateDecision.ts` — pure and
// directly unit-tested, rather than reachable only through a rendered row.
// The empty-list case ("no gate blocks") is handled by the caller and is
// explicitly NOT an error.

function honestyBadgeClass(tone: HonestyTone): string {
  switch (tone) {
    case "ok":
      return "bg-green-500/15 text-green-200 border-green-500/30";
    case "degraded":
      return WAITING_AMBER;
    case "unknown":
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/**
 * The "Gate decisions" header counts, shared verbatim by the MergeTrain panel
 * and the MergePipeline hero — one component rather than two copies, which had
 * already drifted (`ml-1` vs `ml-2`, and only one copy under test).
 *
 * HONESTY, and the whole reason this is not just `{totalBlocks}`:
 *
 * `total_evals` is the discriminator for which coord is on the other end.
 * Coord's pre-Phase-2 handler computes `total_blocks` as a raw `COUNT(*)` over
 * `coord.pr_events` — an EVALUATION count (measured 2026-08-20: 1899 rows for
 * 8 distinct PRs) — and reports no `total_evals` at all. Only a coord that
 * reports `total_evals` has split the two, and only then is `total_blocks`
 * known to be a decision count.
 *
 * So the "decision(s)" noun and the provenance tooltip are rendered ONLY when
 * `totalEvals !== null`. Against an older coord the badge shows the bare
 * number and says outright that its provenance is unknown. Labelling 1899 as
 * "1899 decisions" would be strictly worse than the ambiguous bare number this
 * replaced — an asserted falsehood instead of an unstated ambiguity.
 *
 * Note what is NOT done here: no distinct-PR count is derived from the
 * `blocks` array as a stand-in. That array is capped at coord's `limit`, so
 * counting it would present a lower bound as a total — the same defect class,
 * inverted.
 */
export function GateDecisionCounts({
  totalBlocks,
  totalEvals,
}: {
  totalBlocks: number | null;
  totalEvals: number | null;
}) {
  if (totalBlocks === null) return null;
  // Coord split evaluations from decisions iff it reported `total_evals`.
  const provenanceKnown = totalEvals !== null;
  return (
    <>
      <Badge
        variant="outline"
        className="ml-2 font-mono text-[10px] normal-case"
        data-gate-total-blocks={totalBlocks}
        data-gate-count-provenance={provenanceKnown ? "decisions" : "unknown"}
        title={
          provenanceKnown
            ? "Distinct PRs the blast-radius gate is holding — decisions, not audit rows."
            : "Coord has not reported whether this counts decisions or audit rows. Older deploys returned a raw audit-row count here, which runs far higher than the number of PRs actually held."
        }
      >
        {totalBlocks}
        {provenanceKnown
          ? totalBlocks === 1
            ? " decision"
            : " decisions"
          : ""}
      </Badge>
      {/* The raw audit volume behind those decisions. Coord appends one
          `predicate_eval` row per scheduler tick, so this is normally orders of
          magnitude larger (measured 2026-08-20: 1899 evals for 8 decisions).
          Its own chip — dropping it would hide the write amplification the
          decision count now correctly excludes. Suppressed when it would add
          nothing (equal counts) or when coord never reported it. */}
      {totalEvals !== null && totalEvals > totalBlocks && (
        <Badge
          variant="outline"
          className="ml-1 font-mono text-[10px] normal-case text-muted-foreground"
          data-gate-total-evals={totalEvals}
          title="Raw evaluation rows behind those decisions — coord re-evaluates every held PR on each scheduler tick, so this is far larger than the decision count."
        >
          {totalEvals} evals
        </Badge>
      )}
    </>
  );
}

/**
 * The decision's chips — reason code, outer state, honesty, repetition, age.
 *
 * Shared verbatim by the standalone `GateDecisionRow` and the in-row
 * `GateDecisionDetail`, because the honesty contract is the same claim in both
 * places and a second copy is how the two drift. The PR link is NOT in here:
 * the standalone row needs it (nothing else on screen says which PR), and the
 * in-row form must not have it (the row it sits inside IS the PR, and
 * re-stating the identity is the duplication this redesign removes).
 */
function GateDecisionChips({ block }: { block: BlastRadiusBlock }) {
  const honesty = honestyLabel(block);
  // Repetition, stated rather than enumerated: coord returns the newest row
  // per PR, so a run of identical evaluations collapses to one row carrying
  // its own length. `1` (or an older coord's absent field) renders no chip —
  // "blocked once" and "blocked 547 times" are different operational facts,
  // and only the second one is worth an operator's attention.
  const repeats = gateRepeatCount(block);
  const firstSeenDay = gateFirstSeenDay(block.first_seen_at);
  return (
    <>
      {block.block_reason_code && (
        <Badge variant="outline" className="font-mono text-[10px] normal-case">
          {block.block_reason_code}
        </Badge>
      )}
      {block.outer_state && (
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {block.outer_state}
        </Badge>
      )}
      <Badge
        variant="outline"
        className={`font-mono text-[10px] normal-case ${honestyBadgeClass(
          honesty.tone
        )}`}
        data-honesty-label={honesty.text}
      >
        {honesty.text}
      </Badge>
      {repeats > 1 && (
        <Badge
          variant="outline"
          className={`font-mono text-[10px] normal-case ${WAITING_AMBER}`}
          data-repeat-count={repeats}
          data-first-seen-at={block.first_seen_at ?? ""}
          title={
            firstSeenDay
              ? `Coord re-evaluated this PR and reached the identical decision ${repeats} times since ${firstSeenDay}; this row is the most recent occurrence.`
              : `Coord re-evaluated this PR and reached the identical decision ${repeats} times; this row is the most recent occurrence. First occurrence unknown.`
          }
        >
          ×{repeats}
          {firstSeenDay ? ` since ${firstSeenDay}` : ""}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        {relativeTime(block.at)}
      </span>
    </>
  );
}

/** The removed export and the files still importing it — the gate's evidence. */
function GateDecisionEvidence({ block }: { block: BlastRadiusBlock }) {
  if (!block.removed_export_name && block.referenced_by.length === 0) {
    return null;
  }
  return (
    <>
      {block.removed_export_name && (
        <p className="text-xs mt-1 m-0">
          <span className="font-semibold">Removed export:</span>{" "}
          <code className="font-mono">{block.removed_export_name}</code>
          {block.file && (
            <>
              {" "}
              from <code className="font-mono">{block.file}</code>
            </>
          )}
        </p>
      )}
      {block.referenced_by.length > 0 && (
        <div className="mt-1">
          <p className="text-xs font-semibold m-0">
            Still referenced by ({block.referenced_by.length}):
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {block.referenced_by.map((ref, i) => (
              <li
                key={`${ref.file}:${ref.line}:${i}`}
                className="text-[11px] text-muted-foreground font-mono"
              >
                {ref.file}:{ref.line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * A gate decision on its own, identifying the PR it is about.
 *
 * After the 2026-09-19 redesign this form is used ONLY for decisions whose PR
 * is not in the pipeline list (see `unattachedGateBlocks`) — the audit residue.
 * A decision about a PR that IS listed renders as `GateDecisionDetail` inside
 * that PR's own row instead.
 */
export function GateDecisionRow({ block }: { block: BlastRadiusBlock }) {
  const honesty = honestyLabel(block);
  const repoShort = block.repo.includes("/")
    ? block.repo.split("/").slice(1).join("/")
    : block.repo;
  return (
    <div
      className="border rounded-md p-3 border-border bg-muted/10"
      data-repo={block.repo}
      data-pr-number={block.pr_number}
      data-block-reason-code={block.block_reason_code ?? ""}
      data-honesty-tone={honesty.tone}
    >
      <div className="flex items-start gap-3">
        <ShieldQuestion className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={prHref(block.repo, block.pr_number)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs hover:underline flex items-center gap-1"
            >
              {repoShort}#{block.pr_number}
              <ExternalLink className="h-3 w-3" />
            </a>
            <GateDecisionChips block={block} />
          </div>
          <GateDecisionEvidence block={block} />
        </div>
      </div>
    </div>
  );
}

/**
 * The same decision as EVIDENCE inside the PR's own expanded row.
 *
 * This is where a gate decision belongs, and the reason the page-level "Gate
 * decisions" section is gone: for a PR on this page, "the blast-radius gate
 * held you, here is the export you removed and who still imports it" is an
 * answer to *why is my PR stuck* — the question the row was already opened to
 * ask. As a section it was a second list the operator joined by eye.
 *
 * It carries the SAME honesty chips as the standalone row, and one caveat the
 * standalone form does not need: coord's row is the most recent time the gate
 * reached this decision within its retention window, so it is an audit record
 * rather than an assertion that the PR is held *right now*. That caveat used
 * to be a footnote under the whole section; attached to one decision it can
 * finally be said about the thing it is true of.
 */
export function GateDecisionDetail({ block }: { block: BlastRadiusBlock }) {
  const honesty = honestyLabel(block);
  return (
    <div
      className="space-y-1"
      data-testid="row-gate-decision"
      data-block-reason-code={block.block_reason_code ?? ""}
      data-honesty-tone={honesty.tone}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground m-0 flex items-center gap-1">
        <ShieldQuestion className="h-3 w-3" />
        Blast-radius gate
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <GateDecisionChips block={block} />
      </div>
      <GateDecisionEvidence block={block} />
      <p className="text-[11px] text-muted-foreground m-0">
        The most recent time the gate reached this decision, within
        coord&apos;s retention window — not proof the PR is still held.
      </p>
    </div>
  );
}
