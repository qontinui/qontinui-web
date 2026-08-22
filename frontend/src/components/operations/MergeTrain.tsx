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
//   - `MergeTrainRow`      — one raw scheduler proposal ("Merge internals")
//   - `SuggestionCard`     — one pending drift/audit suggestion
//   - `GateDecisionCounts` — the "Gate decisions" header counts
//   - `GateDecisionRow`    — one blast-radius gate decision
//
// Data for all four comes from `useMergePipelineData`.

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  ShieldQuestion,
} from "lucide-react";
import { relativeTime } from "./utils";
import { redactSecrets } from "./mergeTypes";
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
      return "bg-red-500/15 text-red-200 border-red-500/30";
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
// presented as authoritative.
//   - coverage < 1            -> "partial coverage"
//   - graph_available === false -> "non-authoritative (no resolved graph)"
//   - block_reason_code absent  -> "gate did not run" (distinct from "passed")
//   - coverage/graph absent     -> "coverage not reported" (NOT full coverage)
// The empty-list case ("no gate blocks") is handled at the section level and is
// explicitly NOT an error.

type HonestyTone = "ok" | "degraded" | "unknown";

interface HonestyLabel {
  text: string;
  tone: HonestyTone;
}

/**
 * Derive the coverage / honesty label for a gate block. Pure + total — every
 * branch returns a label, so a row never renders an undefined honesty state.
 */
function honestyLabel(b: BlastRadiusBlock): HonestyLabel {
  // The gate did not run on this PR — the decision is not a gate verdict at
  // all. Distinct from "passed" and from a degraded run.
  if (b.block_reason_code === null || b.block_reason_code === undefined) {
    return { text: "gate did not run", tone: "unknown" };
  }
  // Ran without a resolved code graph — explicitly non-authoritative.
  if (b.graph_available === false) {
    return { text: "non-authoritative (no resolved graph)", tone: "degraded" };
  }
  // Ran on a partial/cold mirror — honest about incompleteness.
  if (typeof b.coverage === "number" && b.coverage < 1) {
    const pct = Math.round(b.coverage * 100);
    return { text: `partial coverage (${pct}%)`, tone: "degraded" };
  }
  // Authoritative full-coverage run.
  if (b.coverage === 1 && b.graph_available === true) {
    return { text: "full coverage", tone: "ok" };
  }
  // Coverage/graph fields not yet plumbed through coord — do NOT claim full
  // coverage we can't substantiate.
  return { text: "coverage not reported", tone: "unknown" };
}

/**
 * How many evaluations a gate-decision row stands for.
 *
 * Coord coalesces byte-identical repeat evaluations onto the newest row and
 * reports the run length as `repeat_count`; a coord that has not shipped that
 * yet omits the field, in which case the row is exactly one evaluation.
 * Clamped to >= 1 on purpose — rendering `×0` would claim the decision never
 * happened, which is the opposite of what the row proves.
 */
function gateRepeatCount(b: BlastRadiusBlock): number {
  const n = b.repeat_count;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * `YYYY-MM-DD` (UTC) for the repeat badge's "since" clause. Returns null both
 * when coord sent no `first_seen_at` AND when what it sent will not parse —
 * the badge then states the count alone rather than substituting `at`, which
 * would falsely claim a zero-length run. The two null causes are deliberately
 * NOT distinguished by the caller's copy: "unknown" is true of both, whereas
 * "not reported" would be a lie about the malformed case.
 */
function gateFirstSeenDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function honestyBadgeClass(tone: HonestyTone): string {
  switch (tone) {
    case "ok":
      return "bg-green-500/15 text-green-200 border-green-500/30";
    case "degraded":
      return "bg-amber-500/15 text-amber-200 border-amber-500/30";
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

export function GateDecisionRow({ block }: { block: BlastRadiusBlock }) {
  const honesty = honestyLabel(block);
  const repoShort = block.repo.includes("/")
    ? block.repo.split("/").slice(1).join("/")
    : block.repo;
  // Repetition, stated rather than enumerated: coord returns the newest row
  // per PR, so a run of identical evaluations collapses to one row carrying
  // its own length. `1` (or an older coord's absent field) renders no chip —
  // "blocked once" and "blocked 547 times" are different operational facts,
  // and only the second one is worth an operator's attention.
  const repeats = gateRepeatCount(block);
  const firstSeenDay = gateFirstSeenDay(block.first_seen_at);
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
            {block.block_reason_code && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] normal-case"
              >
                {block.block_reason_code}
              </Badge>
            )}
            {block.outer_state && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] uppercase"
              >
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
                className="font-mono text-[10px] normal-case bg-amber-500/15 text-amber-200 border-amber-500/30"
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
          </div>
          {block.removed_export_name && (
            <p className="text-xs mt-1">
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
              <p className="text-xs font-semibold">
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
        </div>
      </div>
    </div>
  );
}
