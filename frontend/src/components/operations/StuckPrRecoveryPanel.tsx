"use client";

/**
 * StuckPrRecoveryPanel — the tenant's door out of a wedged merge train.
 *
 * Plan `2026-07-30-coord-tenant-self-service-merge-recovery.md` Phase 4.
 *
 * coord has always DETECTED a wedged PR and always NOTIFIED its author
 * (`GET /pr-merge/:repo/stuck-nudges`). What no customer ever had was a
 * button: the levers that clear a wedge were admin-only, so "my PR is stuck"
 * ended at "contact us, and wait". This panel is the alarm with the door
 * attached.
 *
 * It renders an ACTIONABLE DIAGNOSIS CARD per stuck PR, not a bare button:
 * what is wrong, why we believe it, what can be done, and by whom — sourced
 * from {@link diagnoseStuckPr}, which speaks coord's `coord_diagnose`
 * hypothesis/lever vocabulary so a human here and an agent over MCP are told
 * the same thing. The ACTIONS land on the same coord routes coord's own MCP
 * tools drive, which is what actually keeps the two surfaces from drifting.
 *
 * Renders NOTHING when no PR is stuck. Discoverability without clutter means
 * this page grows a section exactly when there is something to do.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, LifeBuoy, Lock, Terminal } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import type { PrListResponse, PrRow } from "./mergeTypes";
import { useTenantDefaultRepo } from "./useTenantDefaultRepo";
import {
  OPERATIONS_API,
  STUCK_PR_MAX_CARDS,
  STUCK_PR_MAX_VERDICT_READS,
  STUCK_PR_POLL_MS,
  prMergeVerdictUrl,
  prReevaluateUrl,
  proposalCancelUrl,
  stuckNudgesUrl,
} from "./utils";
import {
  CANCEL_REASON,
  LOW_CONFIDENCE_THRESHOLD,
  STALE_PROPOSAL_SECS,
  confidenceLabel,
  describeActionError,
  describeActionSuccess,
  diagnoseStuckPr,
  identityLabel,
  isRetractedByVerdict,
  isTerminalProposalStatus,
  leverAffordance,
  parseProposalView,
  parseStuckNudges,
  type ActionError,
  type Hypothesis,
  type LeverActionKind,
  type NudgeHistory,
  type ProposalView,
  type StuckPr,
  type StuckPrLever,
} from "./stuckPrDiagnosis";

/** One PR the panel believes is wedged, before its proposal has been read. */
export interface StuckCandidate {
  prNumber: number;
  /** coord's live `stuck_now[].reason` code, or `null`. */
  reason: string | null;
  nudgeCount: number;
  maxNudges: number | null;
  /** When coord last nudged this PR's author, or `null`. */
  lastNudgedAt: string | null;
  /** How coord's last nudge landed, or `null`. */
  lastOutcome: string | null;
  /** This PR's `ci_red` ledger row, or `null`. See {@link StuckPr.ciRed}. */
  ciRed: NudgeHistory | null;
  /** coord's own one-line hold reason from `/pr-merge/prs`. */
  blockingSummary: string | null;
}

/**
 * Fuse coord's two independent "this PR is wedged" signals into one candidate
 * list. Pure — exported for the vitest suite.
 *
 * Both are needed and neither is redundant:
 *
 * - `stuck_now[]` from stuck-nudges is coord's LIVE author-facing
 *   classification, but today its closed set is `merge_conflict` only.
 * - A non-terminal merge proposal that has aged past
 *   {@link STALE_PROPOSAL_SECS} is the zombie/livelock class — the one that
 *   motivated this plan, and the one `stuck_now` never reports.
 *
 * Sourcing only the first would leave the actual wedge invisible on the very
 * page built to clear it.
 */
export function fuseStuckCandidates(
  repo: string,
  nudged: StuckPr[],
  maxNudges: number | null,
  prs: PrRow[]
): StuckCandidate[] {
  const byPr = new Map<number, StuckCandidate>();
  for (const n of nudged) {
    byPr.set(n.prNumber, {
      prNumber: n.prNumber,
      reason: n.reason,
      nudgeCount: n.nudgeCount,
      // `parseStuckNudges` already resolves these off coord's `nudges[]`
      // history; taking the whole `StuckPr` rather than three named fields is
      // what stops them being parsed and then silently dropped here.
      lastNudgedAt: n.lastNudgedAt,
      lastOutcome: n.lastOutcome,
      ciRed: n.ciRed,
      maxNudges,
      blockingSummary: null,
    });
  }
  for (const row of prs) {
    if (row.repo !== repo) continue;
    const existing = byPr.get(row.pr_number);
    if (existing) {
      existing.blockingSummary = row.blocking_summary ?? null;
      continue;
    }
    const status =
      typeof row.proposal_status === "string" ? row.proposal_status : null;
    const age =
      typeof row.proposal_age_secs === "number" ? row.proposal_age_secs : null;
    if (
      status !== null &&
      !isTerminalProposalStatus(status) &&
      age !== null &&
      age >= STALE_PROPOSAL_SECS
    ) {
      byPr.set(row.pr_number, {
        prNumber: row.pr_number,
        reason: null,
        nudgeCount: 0,
        lastNudgedAt: null,
        lastOutcome: null,
        // A PR known only from a stale proposal has no stuck-nudges row at all,
        // so there is no `ci_red` history to carry either.
        ciRed: null,
        maxNudges,
        blockingSummary: row.blocking_summary ?? null,
      });
    }
  }
  return [...byPr.values()].sort((a, b) => a.prNumber - b.prNumber);
}

/** Split `owner/name`. Returns `null` for anything that isn't that shape. */
function splitRepo(repo: string): { owner: string; name: string } | null {
  const idx = repo.indexOf("/");
  if (idx <= 0 || idx === repo.length - 1) return null;
  return { owner: repo.slice(0, idx), name: repo.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// Lever rendering
// ---------------------------------------------------------------------------

interface LeverRowProps {
  lever: StuckPrLever;
  busy: LeverActionKind | null;
  onRun: (kind: LeverActionKind) => void;
}

/**
 * One lever, rendered according to {@link leverAffordance} and NOTHING else.
 *
 * The four shapes are visually distinct on purpose — a customer must be able
 * to tell "I can do this", "not right now", "not from here" and "not me"
 * apart at a glance, without reading the reason text.
 */
function LeverRow({ lever, busy, onRun }: LeverRowProps) {
  const [confirming, setConfirming] = useState(false);
  const affordance = leverAffordance(lever);
  const destructive = (lever.consequences?.length ?? 0) > 0;

  // ---- Not this caller's lever: named precisely, never a button. ---------
  if (affordance.kind === "escalate") {
    return (
      <li
        className="rounded-md border border-border p-2"
        data-testid="stuck-pr-lever-escalate"
        data-lever-identity={affordance.identity}
      >
        <div className="flex items-center gap-2">
          <Lock
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="text-sm font-medium">{lever.title}</span>
          <span className="badge badge-muted">
            needs {identityLabel(affordance.identity)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {affordance.reason}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {lever.lever}
        </p>
      </li>
    );
  }

  // ---- Yours, but it happens in your checkout, not here. -----------------
  if (affordance.kind === "manual") {
    return (
      <li
        className="rounded-md border border-border p-2"
        data-testid="stuck-pr-lever-manual"
      >
        <div className="flex items-center gap-2">
          <Terminal
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="text-sm font-medium">{lever.title}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {affordance.reason}
        </p>
        {lever.useWhen && (
          <p className="mt-1 text-xs text-muted-foreground">{lever.useWhen}</p>
        )}
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {lever.lever}
        </p>
      </li>
    );
  }

  const action = affordance.action;
  const disabled = affordance.kind === "blocked" || busy !== null;
  const running = busy === action;

  // ---- The confirm step: state the effects BEFORE the click. -------------
  if (confirming && affordance.kind === "action") {
    return (
      <li
        className="rounded-md border border-border p-2"
        data-testid="stuck-pr-confirm"
        data-lever-action={action}
      >
        <p className="text-sm font-medium">You are about to: {lever.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{lever.why}</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {(lever.consequences ?? []).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-destructive btn-sm"
            data-testid="stuck-pr-confirm-go"
            onClick={() => {
              setConfirming(false);
              onRun(action);
            }}
          >
            Yes — {lever.title.toLowerCase()}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            data-testid="stuck-pr-confirm-cancel"
            onClick={() => setConfirming(false)}
          >
            Never mind
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={
            destructive ? "btn-secondary btn-sm" : "btn-primary btn-sm"
          }
          data-testid={`stuck-pr-lever-${action}`}
          disabled={disabled}
          aria-disabled={disabled}
          title={affordance.kind === "blocked" ? affordance.reason : undefined}
          onClick={() => {
            if (destructive) setConfirming(true);
            else onRun(action);
          }}
        >
          {running && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {lever.title}
        </button>
        {affordance.kind === "blocked" && (
          <span
            className="badge badge-warning"
            data-testid="stuck-pr-lever-blocked"
          >
            not right now
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {affordance.kind === "blocked" ? affordance.reason : lever.why}
      </p>
      {lever.useWhen && affordance.kind === "action" && (
        <p className="mt-1 text-xs text-muted-foreground">{lever.useWhen}</p>
      )}
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {lever.lever}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The diagnosis card
// ---------------------------------------------------------------------------

interface StuckPrDiagnosisCardProps {
  repo: string;
  candidate: StuckCandidate;
  /** coord's stuck-PR nudge feature flag for this repo. */
  nudgesEnabled: boolean;
  /**
   * The PR's merge proposal, read by the PANEL rather than by this card. The
   * panel already polls, and it needs the same verdict to decide whether the PR
   * belongs on the list at all — so fetching it here as well would duplicate
   * every request and let the two disagree.
   */
  proposal: ProposalView | null;
  /**
   * Whether the panel's verdict read has SETTLED for this PR. While `false`,
   * proposal-shaped hypotheses are withheld rather than guessed — "I don't know
   * yet" and "there is no merge attempt" are different claims.
   */
  proposalLoaded: boolean;
  /** Re-run the panel's own reads after a successful action. */
  onActed: () => void;
}

/**
 * One PR's diagnosis + the levers that clear it.
 *
 * Purely a view over {@link diagnoseStuckPr} plus the action handler: the
 * verdict it diagnoses (the ONLY place `proposal_id` is available, and a cancel
 * must be addressed to an id) arrives as a prop from the polling panel.
 */
export function StuckPrDiagnosisCard({
  repo,
  candidate,
  nudgesEnabled,
  proposal,
  proposalLoaded,
  onActed,
}: StuckPrDiagnosisCardProps) {
  const [busy, setBusy] = useState<LeverActionKind | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Memoized so the callback below can depend on the object identity rather
  // than on destructured fields (which would re-create it each render).
  const parts = useMemo(() => splitRepo(repo), [repo]);

  const hypotheses: Hypothesis[] = useMemo(
    () =>
      diagnoseStuckPr({
        repo,
        prNumber: candidate.prNumber,
        reason: candidate.reason,
        nudgeCount: candidate.nudgeCount,
        maxNudges: candidate.maxNudges,
        lastNudgedAt: candidate.lastNudgedAt,
        lastOutcome: candidate.lastOutcome,
        ciRed: candidate.ciRed,
        nudgesEnabled,
        blockingSummary: candidate.blockingSummary,
        proposal,
        proposalLoaded,
      }),
    [repo, candidate, nudgesEnabled, proposal, proposalLoaded]
  );

  const runAction = useCallback(
    async (kind: LeverActionKind) => {
      setActionError(null);
      setResult(null);
      setBusy(kind);
      try {
        let res: Response;
        if (kind === "reevaluate") {
          if (!parts) throw new Error(`unrecognized repo "${repo}"`);
          res = await httpClient.fetch(
            prReevaluateUrl(parts.owner, parts.name, candidate.prNumber),
            { method: "POST", body: JSON.stringify({}) }
          );
        } else {
          if (!proposal) {
            // Unreachable through the UI (cancel levers only exist once a
            // proposal has been read) but stated rather than swallowed.
            throw new Error("no merge attempt to cancel");
          }
          res = await httpClient.fetch(proposalCancelUrl(proposal.proposalId), {
            method: "POST",
            body: JSON.stringify({
              unblock: kind === "cancel_unblock",
              reason: CANCEL_REASON,
            }),
          });
        }
        const body: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActionError(describeActionError(res.status, body));
          return;
        }
        setResult(describeActionSuccess(kind, body));
        // The panel's refresh re-reads the verdict too, so one call re-syncs
        // both the candidate list and this card's proposal.
        onActed();
      } catch (err) {
        setActionError({
          code: "web_error",
          message: err instanceof Error ? err.message : String(err),
          notFound: false,
        });
      } finally {
        setBusy(null);
      }
    },
    [parts, repo, candidate.prNumber, proposal, onActed]
  );

  // `diagnoseStuckPr` never returns an empty list (it emits an explicit
  // low-confidence hypothesis when nothing matches), but the index signature
  // does not say so — degrade to the honest band rather than assert.
  const top = hypotheses[0];
  const band = top ? confidenceLabel(top.confidence) : "low";

  return (
    <div
      className="card p-3"
      data-testid={`stuck-pr-card-${candidate.prNumber}`}
      data-pr-number={candidate.prNumber}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          {repo}#{candidate.prNumber}
        </span>
        <span
          className={
            band === "high"
              ? "badge badge-danger"
              : band === "likely"
                ? "badge badge-warning"
                : "badge badge-muted"
          }
          data-testid="stuck-pr-confidence"
          data-confidence-band={band}
        >
          {band === "low" ? "best guess" : `${band} confidence`}
        </span>
        {candidate.nudgeCount > 0 && (
          <span className="badge badge-muted">
            nudged {candidate.nudgeCount}×
          </span>
        )}
      </div>

      {hypotheses.map((h) => (
        <div
          key={h.hypothesis}
          className="mt-3"
          data-testid="stuck-pr-hypothesis"
          data-hypothesis={h.hypothesis}
        >
          <p className="text-sm">{h.summary}</p>

          {h.confidence < LOW_CONFIDENCE_THRESHOLD && (
            <p
              className="mt-1 text-xs italic text-muted-foreground"
              data-testid="stuck-pr-low-confidence"
            >
              Low confidence — this is a guess from partial evidence, not a
              finding. Re-checking below is the safe way to learn more.
            </p>
          )}

          {h.evidence.length > 0 && (
            <ul className="mt-2 space-y-0.5" data-testid="stuck-pr-evidence">
              {h.evidence.map((e) => (
                <li
                  key={`${e.pointer}:${e.value}`}
                  className="font-mono text-[11px] text-muted-foreground"
                >
                  {e.pointer} = {e.value}
                </li>
              ))}
            </ul>
          )}

          <ul className="mt-2 space-y-2">
            {h.levers.map((lever) => (
              <LeverRow
                key={`${lever.lever}:${lever.title}`}
                lever={lever}
                busy={busy}
                onRun={runAction}
              />
            ))}
          </ul>
        </div>
      ))}

      {result && (
        <p
          className="mt-3 badge badge-success"
          data-testid="stuck-pr-result"
          role="status"
        >
          {result}
        </p>
      )}
      {actionError && (
        <p
          className={
            actionError.notFound
              ? "mt-3 badge badge-muted"
              : "mt-3 badge badge-warning"
          }
          data-testid={
            actionError.notFound ? "stuck-pr-error-not-found" : "stuck-pr-error"
          }
          data-error-code={actionError.code}
          role="alert"
        >
          {actionError.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface StuckPrRecoveryPanelProps {
  /** `owner/name`. Defaults to the active tenant's primary repo. */
  repo?: string;
}

/**
 * Poll coord for the tenant's wedged PRs and render one diagnosis card each.
 *
 * Renders `null` when there is nothing wedged, so the fleet page is unchanged
 * on a healthy day and unmistakable on a bad one.
 */
export function StuckPrRecoveryPanel({ repo }: StuckPrRecoveryPanelProps) {
  const { defaultRepo } = useTenantDefaultRepo();
  const activeRepo = repo ?? defaultRepo;
  const [candidates, setCandidates] = useState<StuckCandidate[]>([]);
  const [staleRead, setStaleRead] = useState(false);
  // coord's `COORD_PR_STUCK_NUDGE_*` flag. Defaults TRUE so an unreadable
  // nudges payload does not put "nudges are off" on the card; the flag is only
  // believed when coord actually states it.
  const [nudgesEnabled, setNudgesEnabled] = useState(true);
  /**
   * Each candidate's merge verdict, keyed by PR number, re-read on every poll.
   *
   * Read HERE and not in the card because the panel needs it to answer a
   * question the card cannot: whether the PR belongs on the list at all. The
   * candidate screen only has `proposal_age_secs` from `/pr-merge/prs`, so a
   * 45-minute CI round trip looks identical to a 45-minute stall; only the
   * verdict's `seconds_since_update` separates them. A `null` value is a
   * SETTLED read that found no proposal; an absent key means "not read yet".
   */
  const [verdicts, setVerdicts] = useState<
    ReadonlyMap<number, ProposalView | null>
  >(() => new Map());

  const refresh = useCallback(async () => {
    if (!activeRepo) return;
    const parts = splitRepo(activeRepo);
    try {
      const [nudgeRes, prRes] = await Promise.all([
        httpClient.fetch(stuckNudgesUrl(activeRepo)),
        httpClient.fetch(`${OPERATIONS_API}/pr-merge/prs`),
      ]);
      const nudgeBody: unknown = nudgeRes.ok ? await nudgeRes.json() : null;
      const prBody: unknown = prRes.ok ? await prRes.json() : null;
      const nudges = parseStuckNudges(nudgeBody);
      const prs = ((prBody as PrListResponse | null)?.prs ?? []) as PrRow[];
      const fused = fuseStuckCandidates(
        activeRepo,
        nudges?.prs ?? [],
        nudges?.maxNudges ?? null,
        prs
      );
      setCandidates(fused);
      setNudgesEnabled(nudges?.enabled ?? true);
      setStaleRead(!nudgeRes.ok && !prRes.ok);

      // Verdicts for the candidates that can plausibly be rendered — bounded,
      // with headroom above STUCK_PR_MAX_CARDS so a retraction that promotes
      // the next candidate promotes one that already has its verdict.
      if (parts) {
        const wanted = fused.slice(0, STUCK_PR_MAX_VERDICT_READS);
        const read = await Promise.all(
          wanted.map(async (c) => {
            try {
              const res = await httpClient.fetch(
                prMergeVerdictUrl(parts.owner, parts.name, c.prNumber)
              );
              // A verdict coord will not serve is not a failure of the panel —
              // the diagnosis proceeds without proposal evidence and says so.
              if (!res.ok) return [c.prNumber, null] as const;
              return [c.prNumber, parseProposalView(await res.json())] as const;
            } catch {
              return [c.prNumber, null] as const;
            }
          })
        );
        setVerdicts(new Map(read));
      }
    } catch {
      // Keep the last known list: a flaky poll must not make a live wedge
      // vanish from the page. The banner below says the view may be stale.
      setStaleRead(true);
    }
  }, [activeRepo]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), STUCK_PR_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Drop the PRs the settled verdict cleared — from the headline count as well
  // as the card list, since "1 pull request is stuck" above zero cards would be
  // the same false alarm one line up. Recomputed from each poll's fresh
  // verdict, so a PR that genuinely wedges later comes straight back.
  const live = candidates.filter(
    (c) =>
      !isRetractedByVerdict({
        repo: activeRepo ?? "",
        prNumber: c.prNumber,
        reason: c.reason,
        nudgeCount: c.nudgeCount,
        maxNudges: c.maxNudges,
        lastNudgedAt: c.lastNudgedAt,
        lastOutcome: c.lastOutcome,
        ciRed: c.ciRed,
        nudgesEnabled,
        blockingSummary: c.blockingSummary,
        proposal: verdicts.get(c.prNumber) ?? null,
        proposalLoaded: verdicts.has(c.prNumber),
      })
  );
  if (!activeRepo || live.length === 0) return null;

  const shown = live.slice(0, STUCK_PR_MAX_CARDS);
  const hidden = live.length - shown.length;

  return (
    <section className="card p-3" data-testid="stuck-pr-panel">
      <div className="flex flex-wrap items-center gap-2">
        <LifeBuoy className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <h2 className="text-sm font-semibold">
          {live.length === 1
            ? "1 pull request is stuck in the merge queue"
            : `${live.length} pull requests are stuck in the merge queue`}
        </h2>
        <span className="text-xs text-muted-foreground">{activeRepo}</span>
        {staleRead && (
          <span className="badge badge-muted" data-testid="stuck-pr-stale-read">
            <AlertTriangle className="h-3 w-3" aria-hidden /> view may be stale
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Each card says what coord thinks is wrong and what you can do about it.
        Nothing here happens until you press a button, and every button says
        what it will change first.
      </p>
      <div className="mt-3 space-y-3">
        {shown.map((c) => (
          <StuckPrDiagnosisCard
            key={c.prNumber}
            repo={activeRepo}
            candidate={c}
            nudgesEnabled={nudgesEnabled}
            proposal={verdicts.get(c.prNumber) ?? null}
            proposalLoaded={verdicts.has(c.prNumber)}
            onActed={() => void refresh()}
          />
        ))}
      </div>
      {hidden > 0 && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="stuck-pr-overflow"
        >
          …and {hidden} more. That many at once usually means one shared cause —
          check the merge train below before clearing them one by one.
        </p>
      )}
    </section>
  );
}

export default StuckPrRecoveryPanel;
