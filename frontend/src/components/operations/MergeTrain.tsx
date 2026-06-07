"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GitMerge,
  AlertTriangle,
  ExternalLink,
  GitBranch,
  RotateCcw,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API, relativeTime } from "./utils";
import type {
  BlastRadiusBlock,
  BlastRadiusBlocksResponse,
  EscalationAlternative,
  EscalationListResponse,
  EscalationRow,
  PrListResponse,
  PrRow,
  ProposalDetail,
  ProposalStatus,
  QueueResponse,
  SuggestionListResponse,
  SuggestionRow,
} from "./mergeTypes";

const log = createLogger("MergeTrain");

const COORD_WS_URL =
  process.env.NEXT_PUBLIC_COORD_WS_URL || "ws://localhost:9870/ws";
const WS_PATTERN = "events.merge.>";
const POLL_INTERVAL_MS = 2_000;
const REFETCH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 5;

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
    case "cancelled":
      return "bg-muted/40 text-muted-foreground border-border line-through";
  }
}

// ----------------------------------------------------------------------------
// PR Merge Orchestrator Phase 1 D1.6 -- PR Outer State row tinting.
//
// Distinct palette from proposal-status above so the operator can tell the
// outer (PR-level) state apart from the inner (proposal-level) state at a
// glance. Driven by GitHub's mergeStateStatus enum, with `mergeable === false`
// overriding any non-failing status to red.
// ----------------------------------------------------------------------------

function prStatusTint(pr: PrRow): string {
  if (pr.mergeable === false) {
    return "bg-red-500/15 text-red-200 border-red-500/30";
  }
  switch (pr.merge_state_status) {
    case "CLEAN":
      return "bg-green-500/15 text-green-200 border-green-500/30";
    case "UNSTABLE":
      return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
    case "BEHIND":
      return "bg-orange-500/15 text-orange-200 border-orange-500/30";
    case "BLOCKED":
    case "DIRTY":
      return "bg-red-500/15 text-red-200 border-red-500/30";
    case "DRAFT":
      return "bg-muted/40 text-muted-foreground border-border";
    case "UNKNOWN":
    case null:
    case undefined:
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function prCiTint(pr: PrRow): string {
  if (pr.ci_lifecycle === "complete" && pr.ci_conclusion === "success") {
    return "bg-green-500/15 text-green-200 border-green-500/30";
  }
  if (pr.ci_lifecycle === "complete" && pr.ci_conclusion === "failure") {
    return "bg-red-500/15 text-red-200 border-red-500/30";
  }
  return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
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
            {proposal.error}
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

// ----------------------------------------------------------------------------
// PR Merge Orchestrator Phase 1 D1.6 -- PR Outer State row component
// ----------------------------------------------------------------------------

function PrRowDisplay({ pr }: { pr: PrRow }) {
  const repoShort = pr.repo.includes("/")
    ? pr.repo.split("/").slice(1).join("/")
    : pr.repo;
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 border rounded-md transition-colors ${prStatusTint(
        pr
      )}`}
      data-pr-state={pr.pr_state}
      data-pr-merge-state-status={pr.merge_state_status ?? ""}
      data-pr-number={pr.pr_number}
    >
      <Badge variant="outline" className="font-mono text-xs">
        {repoShort}#{pr.pr_number}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">
          {pr.branch}{" "}
          <span className="text-muted-foreground">-&gt; {pr.base_branch}</span>
        </p>
        <div className="flex gap-2 mt-0.5 flex-wrap">
          {pr.merge_state_status && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase"
            >
              {pr.merge_state_status}
            </Badge>
          )}
          {pr.review_decision && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase"
            >
              {pr.review_decision}
            </Badge>
          )}
          {pr.mergeable === false && (
            <span className="text-xs text-red-300 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              not mergeable
            </span>
          )}
        </div>
      </div>
      <Badge
        className={`font-mono text-[10px] uppercase tracking-wide ${prCiTint(pr)}`}
      >
        CI: {pr.ci_lifecycle ?? "?"}
        {pr.ci_conclusion ? `/${pr.ci_conclusion}` : ""}
      </Badge>
      <span className="text-xs text-muted-foreground tabular-nums">
        {relativeTime(pr.last_refreshed_at)}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// PR Merge Orchestrator Phase 6 D6.2 — Escalation card
// ----------------------------------------------------------------------------
//
// One card per pending escalation. The severity drives the border colour
// (critical=red, warning=amber, info=muted/hidden). The card body shows
// the PR link, reason (from coord.alerts.detail.reason), specialist
// rationale + rule citations (joined from coord.merge_decisions), the
// suggested action, and a row of alternative-action buttons. Clicking a
// button POSTs to `/operations/pr-merge/escalations/:alert_id/decide`
// with the alternative's `action` + `modification`.

function escalationBorderClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-500/60 bg-red-500/5";
    case "warning":
      return "border-amber-500/60 bg-amber-500/5";
    default:
      return "border-border bg-muted/10 text-muted-foreground";
  }
}

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-red-500/15 text-red-200 border-red-500/30";
    case "warning":
      return "bg-amber-500/15 text-amber-200 border-amber-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Build the GitHub PR URL from repo + pr_number. */
function prHref(repo: string, pr_number: number): string {
  return `https://github.com/${repo}/pull/${pr_number}`;
}

interface EscalationCardProps {
  esc: EscalationRow;
  onDecide: (
    alertId: number,
    action: EscalationAlternative["action"],
    modification: Record<string, unknown> | null
  ) => Promise<void>;
  busy: boolean;
}

function EscalationCard({ esc, onDecide, busy }: EscalationCardProps) {
  const reason = useMemo(() => {
    const r = (esc.detail as Record<string, unknown> | undefined)?.["reason"];
    if (typeof r === "string") return r;
    const sr = (esc.detail as Record<string, unknown> | undefined)?.[
      "system_reason"
    ];
    if (typeof sr === "string") return sr;
    return null;
  }, [esc.detail]);

  return (
    <div
      className={`border rounded-md p-3 mb-2 ${escalationBorderClass(
        esc.severity
      )}`}
      data-alert-id={esc.alert_id}
      data-severity={esc.severity}
      data-repo={esc.repo}
      data-pr-number={esc.pr_number}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={`font-mono text-[10px] uppercase ${severityBadgeClass(
                esc.severity
              )}`}
            >
              {esc.severity}
            </Badge>
            <a
              href={prHref(esc.repo, esc.pr_number)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs hover:underline flex items-center gap-1"
            >
              {esc.repo}#{esc.pr_number}
              <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-xs text-muted-foreground tabular-nums">
              {relativeTime(esc.first_seen_at)}
            </span>
          </div>
          <p className="text-sm mt-1">{esc.summary}</p>
          {reason && (
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-semibold">Reason:</span> {reason}
            </p>
          )}
          {esc.specialist_rationale && (
            <p className="text-xs mt-1">
              <span className="font-semibold">Specialist rationale:</span>{" "}
              {esc.specialist_rationale}
            </p>
          )}
          {esc.specialist_rule_citations.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              <span className="text-xs font-semibold">Rules:</span>
              {esc.specialist_rule_citations.map((c) => (
                <Badge
                  key={c}
                  variant="outline"
                  className="font-mono text-[10px] normal-case"
                >
                  {c}
                </Badge>
              ))}
            </div>
          )}
          {esc.operator_question && (
            <p className="text-xs italic mt-1">
              <span className="font-semibold not-italic">Question:</span>{" "}
              {esc.operator_question}
            </p>
          )}
          {esc.suggested_action && (
            <p className="text-xs mt-1">
              <span className="font-semibold">Suggested:</span>{" "}
              {esc.suggested_action}
            </p>
          )}
          {esc.alternatives.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {esc.alternatives.map((alt) => (
                <Button
                  key={alt.action}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    onDecide(esc.alert_id, alt.action, alt.modification ?? null)
                  }
                  data-action={alt.action}
                >
                  {alt.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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

function SuggestionCard({ sug, busy, onAction }: SuggestionCardProps) {
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

function GateDecisionRow({ block }: { block: BlastRadiusBlock }) {
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

export function MergeTrain() {
  const [proposals, setProposals] = useState<ProposalDetail[] | null>(null);
  // PR Merge Orchestrator Phase 1 D1.6 -- outer PR-level state list.
  const [prs, setPrs] = useState<PrRow[] | null>(null);
  // PR Merge Orchestrator Phase 6 D6.2 -- pending escalations list.
  const [escalations, setEscalations] = useState<EscalationRow[] | null>(null);
  const [decideBusy, setDecideBusy] = useState<number | null>(null);
  // PR Merge Orchestrator Phase 8 D8.6 -- pending suggestions list.
  const [suggestions, setSuggestions] = useState<SuggestionRow[] | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState<number | null>(null);
  // Coordination-transparency T2 -- blast-radius gate decisions (held PRs).
  const [gateBlocks, setGateBlocks] = useState<BlastRadiusBlock[] | null>(null);
  const [gateTotalBlocks, setGateTotalBlocks] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanedUpRef = useRef(false);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/merge/queue`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as QueueResponse | ProposalDetail[];
      // Coord returns {proposals: [...]}; tolerate either shape.
      const list = Array.isArray(body) ? body : (body.proposals ?? []);
      if (!cleanedUpRef.current) {
        setProposals(list);
        setError(null);
      }
    } catch (err) {
      if (!cleanedUpRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  // PR Merge Orchestrator Phase 6 D6.2 -- fetch active escalations.
  // Best-effort like fetchPrs: a failure here does NOT clear `error`
  // (proposal-side wins). 404 on this endpoint means coord hasn't been
  // deployed with the Phase 6 endpoint yet -- silently skip rendering
  // the escalations section in that case.
  const fetchEscalations = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/escalations?include_resolved=false`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setEscalations([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | EscalationListResponse
        | EscalationRow[];
      const list = Array.isArray(body) ? body : (body.escalations ?? []);
      if (!cleanedUpRef.current) {
        setEscalations(list);
      }
    } catch (err) {
      log.warn("fetchEscalations failed", err);
      if (!cleanedUpRef.current) setEscalations([]);
    }
  }, []);

  // PR Merge Orchestrator Phase 6 D6.4 -- operator-decision POST.
  // Filters `info` severity rows out of the active-escalations render but
  // leaves the decide path open for them if/when alternatives become
  // available.
  const onDecide = useCallback(
    async (
      alertId: number,
      action: EscalationAlternative["action"],
      modification: Record<string, unknown> | null
    ) => {
      setDecideBusy(alertId);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/escalations/${alertId}/decide`,
          {
            method: "POST",
            body: JSON.stringify({
              resolution_action: action,
              rationale: `Operator chose ${action} via dashboard`,
              ...(modification != null ? { modification } : {}),
            }),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          log.warn("decide failed", res.status, text);
          if (!cleanedUpRef.current)
            setError(`Decide failed: HTTP ${res.status}`);
          return;
        }
        // Refetch to drop the now-resolved row from the active list.
        await fetchEscalations();
      } catch (err) {
        log.warn("decide threw", err);
        if (!cleanedUpRef.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cleanedUpRef.current) setDecideBusy(null);
      }
    },
    [fetchEscalations]
  );

  // PR Merge Orchestrator Phase 8 D8.6 -- fetch pending suggestions.
  // Drift suggestions + audit-stale alerts. Best-effort, 404-tolerant.
  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/suggestions`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setSuggestions([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | SuggestionListResponse
        | SuggestionRow[];
      const list = Array.isArray(body) ? body : (body.suggestions ?? []);
      if (!cleanedUpRef.current) {
        setSuggestions(list);
      }
    } catch (err) {
      log.warn("fetchSuggestions failed", err);
      if (!cleanedUpRef.current) setSuggestions([]);
    }
  }, []);

  // PR Merge Orchestrator Phase 8 D8.6 -- Accept / Reject / Mute handlers.
  const onSuggestionAction = useCallback(
    async (
      alertId: number,
      action: "accept" | "reject" | "mute",
      body?: Record<string, unknown>
    ) => {
      setSuggestionBusy(alertId);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/suggestions/${alertId}/${action}`,
          {
            method: "POST",
            body: JSON.stringify(body ?? {}),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          log.warn(`suggestion ${action} failed`, res.status, text);
          if (!cleanedUpRef.current)
            setError(`Suggestion ${action} failed: HTTP ${res.status}`);
          return;
        }
        await fetchSuggestions();
      } catch (err) {
        log.warn(`suggestion ${action} threw`, err);
        if (!cleanedUpRef.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cleanedUpRef.current) setSuggestionBusy(null);
      }
    },
    [fetchSuggestions]
  );

  // Coordination-transparency T2 -- fetch the blast-radius gate decisions.
  // Best-effort + 404-tolerant, mirroring fetchEscalations: a failure here
  // never clears `error` (the proposal queue owns that surface) and a 404
  // means coord hasn't shipped `/pr-merge/blast-radius-blocks` yet, so we
  // render an empty (hidden) section rather than an error.
  const fetchGateBlocks = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/blast-radius-blocks`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) {
            setGateBlocks([]);
            setGateTotalBlocks(0);
          }
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | BlastRadiusBlocksResponse
        | BlastRadiusBlock[];
      const list = Array.isArray(body) ? body : (body.blocks ?? []);
      const total = Array.isArray(body)
        ? body.length
        : (body.total_blocks ?? list.length);
      if (!cleanedUpRef.current) {
        setGateBlocks(list);
        setGateTotalBlocks(total);
      }
    } catch (err) {
      log.warn("fetchGateBlocks failed", err);
      if (!cleanedUpRef.current) {
        setGateBlocks([]);
        setGateTotalBlocks(0);
      }
    }
  }, []);

  // PR Merge Orchestrator Phase 1 D1.6 -- fetch the outer PR list. Best-effort:
  // a failure here does NOT clear `error` (the queue fetch owns that) so the
  // user always sees the more-actionable proposal-side error if both fail.
  const fetchPrs = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/pr-merge/prs`);
      if (!res.ok) {
        // 404 here means the coord backend hasn't been deployed with the
        // Phase 1 endpoint yet -- silently skip rendering the outer card.
        if (res.status === 404) {
          if (!cleanedUpRef.current) setPrs([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as PrListResponse | PrRow[];
      const list = Array.isArray(body) ? body : (body.prs ?? []);
      if (!cleanedUpRef.current) {
        setPrs(list);
      }
    } catch (err) {
      log.warn("fetchPrs failed", err);
      // Don't surface PR-list fetch errors in the merge-train error toast --
      // the proposal queue is the primary surface; the outer PR state is
      // additive Phase 1 work. Render an empty section instead.
      if (!cleanedUpRef.current) setPrs([]);
    }
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      // Phase 1 D1.6: refetch both surfaces on any merge-event signal.
      // The outer PR state changes on the same triggers (push, check_run,
      // pull_request_review) that the WS pattern subscribes to via the
      // `events.github.>` fanout, so co-refetching keeps the two columns
      // visually consistent.
      fetchQueue();
      fetchPrs();
      // Phase 6 D6.2: escalations can fire on the same events (a
      // failing check_run can trigger a specialist run that escalates).
      fetchEscalations();
      // Phase 8 D8.6: suggestions are background-watcher-emitted, not
      // event-driven, so this fetch is a low-stakes refresh — it catches
      // newly-emitted drift suggestions on the same WS-driven tick.
      fetchSuggestions();
      // Coordination-transparency T2: a gate decision is appended on the same
      // predicate-eval tick a check_run/push triggers, so co-refetch keeps the
      // held-PRs view consistent with the queue/PR columns.
      fetchGateBlocks();
    }, REFETCH_DEBOUNCE_MS);
  }, [
    fetchQueue,
    fetchPrs,
    fetchEscalations,
    fetchSuggestions,
    fetchGateBlocks,
  ]);

  const connectWs = useCallback(() => {
    if (cleanedUpRef.current || document.hidden) return;
    if (wsRef.current) wsRef.current.close();

    const url = `${COORD_WS_URL}?pattern=${encodeURIComponent(WS_PATTERN)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log.warn("WebSocket constructor failed", err);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (cleanedUpRef.current) {
        ws.close();
        return;
      }
      reconnectAttemptsRef.current = 0;
      // Resync after (re)connect — events flow live but the snapshot
      // catches any updates that happened during the disconnect.
      scheduleRefetch();
    };

    ws.onmessage = () => {
      // The merge-event payload only signals "something changed."
      // Refetch the queue to get the canonical state.
      scheduleRefetch();
    };

    ws.onerror = (e) => {
      log.warn("WS error", e);
    };

    ws.onclose = () => {
      if (cleanedUpRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        log.warn("WS max reconnect attempts reached; relying on poll");
        return;
      }
      const delay = Math.min(1_000 * 2 ** reconnectAttemptsRef.current, 30_000);
      reconnectAttemptsRef.current += 1;
      reconnectRef.current = setTimeout(connectWs, delay);
    };
  }, [scheduleRefetch]);

  useEffect(() => {
    cleanedUpRef.current = false;
    fetchQueue();
    fetchPrs();
    fetchEscalations();
    fetchSuggestions();
    fetchGateBlocks();
    const pollId = setInterval(() => {
      fetchQueue();
      fetchPrs();
      fetchEscalations();
      fetchSuggestions();
      fetchGateBlocks();
    }, POLL_INTERVAL_MS);
    connectWs();
    return () => {
      cleanedUpRef.current = true;
      clearInterval(pollId);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [
    fetchQueue,
    fetchPrs,
    fetchEscalations,
    fetchSuggestions,
    fetchGateBlocks,
    connectWs,
  ]);

  // PR Merge Orchestrator Phase 1 D1.6 -- decide whether to render the PR
  // Outer State sub-section. We render the heading + content only when BOTH
  // proposal-state and pr-state are present, matching the plan's instruction
  // ("add a section heading 'PR Outer State' above the existing proposal
  // state when both are present").
  const showOuterSection = prs !== null && prs.length > 0 && proposals !== null;

  // PR Merge Orchestrator Phase 6 D6.2 -- filter `info` severity rows
  // OUT of the active-escalations list (per the plan: "don't show in
  // active escalations"), and sort `critical` rows to the top.
  const activeEscalations = useMemo(() => {
    if (!escalations) return null;
    const filtered = escalations.filter((e) => e.severity !== "info");
    return filtered.sort((a, b) => {
      const order = (s: string) =>
        s === "critical" ? 0 : s === "warning" ? 1 : 2;
      return order(a.severity) - order(b.severity);
    });
  }, [escalations]);
  const showEscalationsSection =
    activeEscalations !== null && activeEscalations.length > 0;
  // PR Merge Orchestrator Phase 8 D8.6 -- Suggestions inbox visibility.
  const showSuggestionsSection = suggestions !== null && suggestions.length > 0;
  // Coordination-transparency T2 -- show the Gate decisions section once the
  // fetch has resolved (even with zero blocks, so the honest "no gate blocks"
  // state is visible rather than the section silently vanishing).
  const showGateDecisionsSection = gateBlocks !== null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="h-4 w-4" />
          Merge train
          {proposals && (
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              {proposals.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {showSuggestionsSection && suggestions && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              Suggestions
              <Badge
                variant="outline"
                className="ml-2 font-mono text-[10px] normal-case"
              >
                {suggestions.length}
              </Badge>
            </h4>
            <div className="space-y-2">
              {suggestions.map((sug) => (
                <SuggestionCard
                  key={sug.alert_id}
                  sug={sug}
                  busy={suggestionBusy === sug.alert_id}
                  onAction={onSuggestionAction}
                />
              ))}
            </div>
          </div>
        )}
        {showEscalationsSection && activeEscalations && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              Escalations
              <Badge
                variant="outline"
                className="ml-2 font-mono text-[10px] normal-case"
              >
                {activeEscalations.length}
              </Badge>
            </h4>
            <div>
              {activeEscalations.map((esc) => (
                <EscalationCard
                  key={esc.alert_id}
                  esc={esc}
                  onDecide={onDecide}
                  busy={decideBusy === esc.alert_id}
                />
              ))}
            </div>
          </div>
        )}
        {showGateDecisionsSection && gateBlocks && (
          <div className="mb-4" data-testid="gate-decisions">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <ShieldQuestion className="h-3 w-3" />
              Gate decisions
              {gateTotalBlocks !== null && (
                <Badge
                  variant="outline"
                  className="ml-2 font-mono text-[10px] normal-case"
                >
                  {gateTotalBlocks}
                </Badge>
              )}
            </h4>
            {gateBlocks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No gate blocks — the blast-radius merge gate has not held any of
                your PRs.
              </p>
            ) : (
              <div className="space-y-2">
                {gateBlocks.map((b) => (
                  <GateDecisionRow
                    key={`${b.repo}#${b.pr_number}@${b.at}`}
                    block={b}
                  />
                ))}
                <p className="text-[11px] text-muted-foreground pt-1">
                  A held PR is unblocked by an operator decision in the
                  Escalations section above
                  {showEscalationsSection ? "" : " (when one is pending)"}.
                  Coverage labels reflect how complete the code graph was when
                  the gate ran — a degraded decision is never authoritative.
                </p>
              </div>
            )}
          </div>
        )}
        {showOuterSection && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              PR Outer State
              <Badge
                variant="outline"
                className="ml-2 font-mono text-[10px] normal-case"
              >
                {prs.length}
              </Badge>
            </h4>
            <div className="space-y-2">
              {prs.map((p) => (
                <PrRowDisplay key={`${p.repo}#${p.pr_number}`} pr={p} />
              ))}
            </div>
          </div>
        )}
        {proposals === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : proposals.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No in-flight proposals.
          </p>
        ) : (
          <div className="space-y-2">
            {proposals.map((p) => (
              <MergeTrainRow key={p.proposal_id} proposal={p} />
            ))}
          </div>
        )}
        {/* PR Merge Orchestrator Phase 5 D5.5 — link to the dedicated
            cross-repo dependency DAG view. Sibling MergeDependencyGraph
            component is rendered on the same operations page below the
            MergeTrain card. */}
        <div className="mt-4 pt-3 border-t border-border/40">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            Cross-repo dependencies
          </h4>
          <p className="text-xs text-muted-foreground">
            See the{" "}
            <a
              href="#merge-dep-graph"
              className="underline hover:text-foreground"
            >
              dependency graph
            </a>{" "}
            below for the connected component of any PR. Topological auto-merge
            is enforced upstream-first; cycle members are flagged red.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
