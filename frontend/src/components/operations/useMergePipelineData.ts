"use client";

// ============================================================================
// useMergePipelineData — one data owner for the unified merge-pipeline view.
// ============================================================================
//
// Fleet-page redesign (qontinui-dev-notes/prompts/
// coord-fleet-page-redesign-2026-07-14.md): the MergePipeline hero fuses the
// proposal queue and the PR outer state, so a single hook fetches BOTH plus
// the two actionable side-channels (suggestions, blast-radius gate blocks).
// Transport: WS push on coord's `events.merge.*` — through the web backend's
// coord-events bridge (`subscribe=merge`) — with a debounced co-refetch of
// every surface, plus a slow poll fallback. Having ONE owner (instead of the
// pre-redesign MergeTrain panel polling the same four endpoints on its own)
// keeps the dashboard at the same request budget as before the redesign.
//
// This is the hero's ONLY fetch site, and must stay so. A full duplicate of
// all four fetches plus a second WebSocket client survived inside
// `MergeTrain` for five weeks after that component stopped being rendered
// (2026-07-15, `946e06c7`) — unreachable, and still under maintenance: PR
// #1032 edited both copies of `fetchGateBlocks`, only one of which could run.
// `mergeDataOwner.test.ts` pins the property at the source level, because a
// render test cannot see a component that never mounts. Note the guard's own
// scope: `/merge/queue` and `/pr-merge/prs` are legitimately read by other
// SURFACES too (StuckPrRecoveryPanel, usePrCheckDetails)
// — what may not happen again is the hero fetching them a second time.
//
// Load discipline (2026-07-21 prod incident): every request in a batch pins
// a backend DB connection for its WHOLE lifetime — the operations proxy
// holds its pooled session across the outbound coord round-trip. So the
// dashboard's request volume is directly a backend connection-pool cost,
// and an unbounded one takes the API down. Three rules keep it bounded:
//
//   1. Single-flight — a batch already in flight absorbs new triggers
//      instead of stacking. Previously a fixed 2s `setInterval` fired
//      regardless of whether the last batch had returned, so rising latency
//      made batches overlap without bound: a textbook positive feedback
//      loop that exhausted the pool (8 + 12 overflow) and 504'd sign-in.
//   2. Gap measured from COMPLETION, not from start — a slow backend
//      stretches the poll gap rather than piling on.
//   3. Hidden tabs don't poll — a backgrounded dashboard left open for
//      hours is pure load with nobody reading it.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API, coordEventsWsUrl } from "./utils";
import { isMergedPr } from "./prPipeline";
import type {
  BlastRadiusBlock,
  BlastRadiusBlocksResponse,
  MergeEconomics,
  MergeEconomicsResponse,
  PrListResponse,
  PrRow,
  ProposalDetail,
  QueueResponse,
  SuggestionListResponse,
  SuggestionRow,
} from "./mergeTypes";

const log = createLogger("useMergePipelineData");

/**
 * The bridge subscription this hook opens. The web backend forwards it to
 * coord's authenticated `/ws?subscribe=merge`, which coord resolves to
 * `events.merge.*` server-side. The hook used to dial coord directly on
 * `NEXT_PUBLIC_COORD_WS_URL` with `?pattern=events.merge.>` — a NATS
 * wildcard, not a Redis glob, so that subscription had never matched a
 * frame and the "live transport" was the 15s poll all along. Plan
 * 2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose
 * Phase 2 re-homed it and fixed the pattern in the same move.
 */
const WS_SUBSCRIPTION = "merge" as const;

/**
 * True for the coord-events bridge's own `{"type":"keepalive"}` frame — the
 * one text frame on this socket that carries no coord event (finding
 * 67329129). Exported so the shape is pinned by a unit test independent of
 * the WS plumbing: anything that doesn't parse as JSON, or parses but isn't
 * this exact shape, is treated as a real coord frame and refetches, which is
 * the safe default for an envelope this hook doesn't otherwise recognize.
 */
export function isKeepaliveFrame(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    return parsed?.type === "keepalive";
  } catch {
    return false;
  }
}

// Fallback only — the WS is the live transport, so this just bounds staleness
// if the socket is down. 2s here meant 5 authenticated requests every 2s per
// open tab against a 20-connection backend pool.
const POLL_INTERVAL_MS = 15_000;
/**
 * Floor on how often trigger-driven batches (WS push, tab reveal) may START.
 * Single-flight caps CONCURRENCY at one batch but not RATE: without this, a
 * merge-train fan-out emitting events faster than the debounce keeps a batch
 * permanently in flight, which is the same completion-rate-bound load the
 * poll change exists to escape.
 */
const MIN_BATCH_SPACING_MS = 3_000;
/**
 * Lookback for the pipeline's "Merged" tab, forwarded to coord as
 * `?include_merged=<hours>`. coord appends recently-landed PR rows (keyed on
 * the `merge_commit_sha` + `merged_at` land stamp, so BOTH the merge-button
 * path and coord's own fast-forward lands are included) to the open/draft
 * list. A coord deploy that does not honor the param simply returns the open
 * list — the tab renders empty rather than breaking.
 */
export const MERGED_LOOKBACK_HOURS = 48;
/**
 * Cadence for the recently-merged rows — deliberately ~30x slower than the hot
 * poll, and only ticking while the Merged or All PRs tab is open.
 *
 * `?include_merged=` makes coord run `query_recently_merged_prs`, which
 * resolves a deploy surface per repo (a git-ancestry probe per merged PR) on
 * top of the open-PR scan. Measured against prod on 2026-07-21 the plain
 * endpoint already takes ~31s and 500s at its 30s gateway timeout under load;
 * with `include_merged` it timed out 5/5. Asking for that set on a 2s loop is
 * both useless (landings are minutes apart, not seconds) and actively harmful
 * — it multiplies an already-marginal query by the poll rate. Landing history
 * is cold data; poll it like cold data.
 */
const MERGED_POLL_INTERVAL_MS = 60_000;
/**
 * A merged read is skipped when the last one finished less than this long ago,
 * whoever asked (the timer, a tab re-shown, `includeMerged` flipping back on).
 * Half the poll interval: fresh enough that a re-show shows current data, long
 * enough that a burst of events cannot start a burst of 14-21s reads.
 */
const MERGED_MIN_AGE_MS = MERGED_POLL_INTERVAL_MS / 2;
const REFETCH_DEBOUNCE_MS = 250;
const MAX_RECONNECT_ATTEMPTS = 5;

/** Options for {@link useMergePipelineData}. */
export interface MergePipelineOptions {
  /**
   * Fetch recently-merged rows. False (default) keeps the hot poll on the
   * cheap open-PR query; the caller sets it only while a tab that shows landed
   * PRs (Merged, All PRs) is the visible one.
   */
  includeMerged?: boolean;
}

export interface MergePipelineData {
  /** null while the first fetch is in flight. */
  proposals: ProposalDetail[] | null;
  prs: PrRow[] | null;
  /**
   * Recently-merged rows for the Merged tab. `null` until the first merged
   * fetch resolves, and it only ever runs while the caller passes
   * `includeMerged` — so this stays null for the whole session on the tabs
   * that show no landed PRs, which is exactly the point.
   */
  mergedPrs: PrRow[] | null;
  /**
   * Why the LAST merged-rows read failed, or null when it has not failed since
   * it last succeeded. Non-null means the merged history is not current, and
   * which way depends on `mergedPrs`:
   *
   * - `mergedPrs === null` (never loaded): the history is INCOMPLETE, not
   *   empty. The only landed rows a consumer holds are the open list's
   *   `landed-open` ones, which carry no merge time.
   * - `mergedPrs` non-null: the last GOOD read is kept, so those rows have
   *   merge times and include PRs that already closed — but they are STALE.
   *
   * A consumer must say which, rather than render either as current history.
   */
  mergedError: string | null;
  /**
   * How many PRs landed in the {@link MERGED_LOOKBACK_HOURS} window, per
   * coord's cheap count — available WITHOUT the expensive merged-rows read, so
   * the Merged tab can be labelled before anyone opens it. `null` = unknown
   * (not yet fetched, coord too old to answer, or its count failed); a caller
   * must render that as "unknown", never as 0.
   */
  mergedCount: number | null;
  /**
   * Per-repo merge economics keyed by `owner/name`. Never null — it defaults
   * to an empty map, and a 404 / coord-down / not-yet-deployed economics read
   * keeps it empty, so prPipeline transparently falls back to its hardcoded
   * thresholds + repo-name hint. There is no "loading" state to distinguish.
   */
  economicsByRepo: Record<string, MergeEconomics>;
  suggestions: SuggestionRow[] | null;
  gateBlocks: BlastRadiusBlock[] | null;
  /**
   * Distinct PRs the blast-radius gate is holding — DECISIONS. Coord's
   * `total_blocks` was a raw `pr_events` row count until plan
   * 2026-08-20-predicate-eval-surface-counts-evals-not-decisions Phase 2.
   */
  gateTotalBlocks: number | null;
  /**
   * Raw evaluation-row count behind those decisions (coord's `total_evals`).
   * `null` when coord did not report it — an older deploy that never
   * separated the two. Consumers must render that as silence, not as a
   * duplicate of `gateTotalBlocks`.
   */
  gateTotalEvals: number | null;
  /** Error from the primary (queue) fetch — the actionable surface. */
  error: string | null;
  suggestionBusy: number | null;
  onSuggestionAction: (
    alertId: number,
    action: "accept" | "reject" | "mute",
    body?: Record<string, unknown>
  ) => void;
  /**
   * Debounced manual refresh. Per-row operator actions (e.g. the draft-state
   * toggle) call it after a successful mutation to pull the pipeline forward,
   * so the row follows the twin once the reconciling webhook lands. Stable
   * identity — safe to pass through the row tree without re-binding children.
   */
  refetch: () => void;
}

export function useMergePipelineData(
  opts: MergePipelineOptions = {}
): MergePipelineData {
  const includeMerged = opts.includeMerged ?? false;
  const [proposals, setProposals] = useState<ProposalDetail[] | null>(null);
  const [prs, setPrs] = useState<PrRow[] | null>(null);
  const [mergedPrs, setMergedPrs] = useState<PrRow[] | null>(null);
  const [mergedError, setMergedError] = useState<string | null>(null);
  const [mergedCount, setMergedCount] = useState<number | null>(null);
  const [economicsByRepo, setEconomicsByRepo] = useState<
    Record<string, MergeEconomics>
  >({});
  const [suggestions, setSuggestions] = useState<SuggestionRow[] | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState<number | null>(null);
  const [gateBlocks, setGateBlocks] = useState<BlastRadiusBlock[] | null>(null);
  const [gateTotalBlocks, setGateTotalBlocks] = useState<number | null>(null);
  const [gateTotalEvals, setGateTotalEvals] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  // Every `connectWs` attempt awaits its session token; one overtaken while
  // it waited (another connect, cleanup, tab hide) must create no socket.
  const connectGenRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanedUpRef = useRef(false);
  /** A batch is in flight — new triggers coalesce into `rerunRef`. */
  const inFlightRef = useRef(false);
  // The merged read runs on its own slower chain. Separate from `inFlightRef`:
  // sharing one flag would let a 20s merged read swallow the hot poll. Owned
  // here rather than by an effect run — see `readMergedIfStale`.
  const mergedReadRef = useRef<Promise<void> | null>(null);
  const mergedDoneAtRef = useRef(0);
  /** A trigger arrived mid-batch; run exactly one more batch after it. */
  const rerunRef = useRef(false);
  /** Latest `fetchAll`, so timers/listeners need not re-bind on each change. */
  const fetchAllRef = useRef<() => Promise<void>>(async () => {});
  /** Epoch ms of the last batch START. */
  const lastBatchStartedAtRef = useRef(0);
  /**
   * Epoch ms of the last batch SETTLING. `MIN_BATCH_SPACING_MS` anchors to
   * whichever of the two is later: anchoring to start alone makes the floor
   * evaporate for any batch slower than the floor (elapsed already exceeds
   * it the moment the batch ends), which is precisely the degraded regime it
   * has to hold in. Anchoring to completion guarantees a real idle gap in
   * which the backend's pooled connections are actually released.
   */
  const lastBatchEndedAtRef = useRef(0);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/merge/queue`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as QueueResponse | ProposalDetail[];
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

  // Best-effort + 404-tolerant: a coord deploy without the endpoint renders
  // as an empty list, never as an error (the queue fetch owns `error`).
  //
  // The hot poll asks for OPEN PRs only. Merged ROWS are a separate, much
  // slower fetch (see fetchMergedPrs) because `?include_merged=` is an order
  // of magnitude more expensive server-side.
  //
  // It does, however, carry `?merged_count_hours=` — coord's cheap merged
  // COUNT (one count over the `idx_repo_branches_merged_at` partial index, no
  // per-PR deploy classification). That rides here deliberately: it answers
  // "how many landed?" for the Merged tab's label without a sixth request in
  // the batch — so the request budget, and therefore the backend connection
  // budget this file's header is about, is unchanged — and without dragging in
  // the read that took the API down on 2026-07-21.
  const fetchPrs = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/prs?merged_count_hours=${MERGED_LOOKBACK_HOURS}`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setPrs([]);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as PrListResponse | PrRow[];
      const list = Array.isArray(body) ? body : (body.prs ?? []);
      // Absent means UNKNOWN — a coord too old to answer, or one whose count
      // failed and was omitted rather than failing the listing. That resets to
      // null (the caller renders a dash) instead of leaving the last number on
      // screen: a stale count carries no staleness signal, so it would read as
      // a current fact forever. Note 0 is a fact and survives; only absence is
      // unknown. This is the SUCCESS path only — a failed request keeps
      // whatever we last knew, same as the PR list below.
      const count = Array.isArray(body) ? undefined : body.merged_recent_count;
      if (!cleanedUpRef.current) {
        setPrs(list);
        setMergedCount(typeof count === "number" ? count : null);
      }
    } catch (err) {
      // Keep the last known-good list. This endpoint is slow enough on a
      // loaded fleet to intermittently 500/504 at the gateway (~30s); wiping
      // to [] on each miss made the whole pipeline blink empty mid-triage,
      // which reads as "nothing to do" rather than "the read failed". 404 is
      // handled above and IS authoritative emptiness.
      log.warn("fetchPrs failed — keeping last known rows", err);
      if (!cleanedUpRef.current) setPrs((prev) => prev ?? []);
    }
  }, []);

  // Recently-merged rows. Fetched ONLY while the caller asks for them (the
  // Merged or All PRs tab is open) and on a slow cadence — see
  // MERGED_POLL_INTERVAL_MS
  // for why this must never ride the hot poll.
  const fetchMergedPrs = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/prs?include_merged=${MERGED_LOOKBACK_HOURS}`,
        // No client retry. The client retries every 5xx up to 3 times, and each
        // attempt is a full coord query that holds a backend DB connection for
        // its whole (14-21s) life: a coord that is already struggling would be
        // asked the same expensive question four times per poll. The next poll
        // IS the retry, on the cold cadence this read is meant to have.
        { maxRetries: 0 }
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) {
            setMergedPrs([]);
            setMergedError(null);
          }
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as PrListResponse | PrRow[];
      const list = Array.isArray(body) ? body : (body.prs ?? []);
      // Every row this endpoint adds beyond the open list has LANDED —
      // coord's merged query requires `merge_commit_sha IS NOT NULL`, and the
      // open query never projects that column. So the merged set is exactly
      // the rows carrying a merge sha, whatever `pr_state` says — plus any
      // open row coord classifies `landed-open` (landed at its current head,
      // sha not projected on open rows); see `isMergedPr`.
      //
      // Filtering on `pr_state IN (merged, closed)` instead — what this did —
      // silently dropped coord's ff-lands during their phantom-open window: an
      // ff-land pushes a rebased sha straight to the base branch, so GitHub
      // never auto-closes the PR and its mirrored pr_state stays 'open' until
      // the straggler sweep. coord deliberately stopped gating on pr_state for
      // exactly that reason; re-imposing it here made those landings invisible
      // in the merged tab and left them rendered as live work in the open one.
      // De-duplication against the open list is the consumer's job (see
      // MergePipeline) — dropping rows is not.
      if (!cleanedUpRef.current) {
        setMergedPrs(list.filter(isMergedPr));
        setMergedError(null);
      }
    } catch (err) {
      // Keep whatever is held, INCLUDING null. Coercing null to [] here made a
      // failed first read look like "nothing landed": the Merged label fell
      // from coord's cheap count to 0. Null keeps that label honest, and it
      // matters more now the read also runs on the default All PRs tab.
      log.warn("fetchMergedPrs failed — keeping last known merged rows", err);
      // Kept rows are STALE and a never-loaded set is INCOMPLETE; either way
      // the consumer needs to be told, not left to infer it from an absence.
      if (!cleanedUpRef.current) {
        setMergedError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  // Per-repo merge economics — the CI-duration-aware severity input. Same
  // best-effort + 404-tolerant contract as fetchPrs: coord may not have the
  // `coord_query_merge_economics` read deployed yet (or it may be transiently
  // down), in which case this stays an empty map and prPipeline falls back to
  // its hardcoded thresholds + repo-name hint. Never surfaces an error.
  // Tolerates three wire shapes: an object keyed by `owner/name`, a
  // `{ repos: {...} }` wrapper, or an array of `{ repo, ...economics }`.
  const fetchEconomics = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/merge-economics`
      );
      if (!res.ok) {
        if (res.status === 404) {
          if (!cleanedUpRef.current) setEconomicsByRepo({});
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as
        | MergeEconomicsResponse
        | Record<string, MergeEconomics>
        | Array<MergeEconomics & { repo?: string }>;
      let map: Record<string, MergeEconomics> = {};
      if (Array.isArray(body)) {
        for (const e of body) {
          if (e && typeof e.repo === "string") map[e.repo] = e;
        }
      } else if (
        body &&
        typeof body === "object" &&
        "repos" in body &&
        body.repos &&
        typeof body.repos === "object"
      ) {
        map = body.repos as Record<string, MergeEconomics>;
      } else if (body && typeof body === "object") {
        // Already keyed by repo.
        map = body as Record<string, MergeEconomics>;
      }
      if (!cleanedUpRef.current) setEconomicsByRepo(map);
    } catch (err) {
      log.warn("fetchEconomics failed", err);
      if (!cleanedUpRef.current) setEconomicsByRepo({});
    }
  }, []);

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
      if (!cleanedUpRef.current) setSuggestions(list);
    } catch (err) {
      log.warn("fetchSuggestions failed", err);
      if (!cleanedUpRef.current) setSuggestions([]);
    }
  }, []);

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
            setGateTotalEvals(null);
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
      // Optional by contract — absent means an older coord that never split
      // evaluations from decisions. Keep it null so the surface says nothing
      // about evaluation volume rather than echoing the decision count.
      const evals =
        !Array.isArray(body) && typeof body.total_evals === "number"
          ? body.total_evals
          : null;
      if (!cleanedUpRef.current) {
        setGateBlocks(list);
        setGateTotalBlocks(total);
        setGateTotalEvals(evals);
      }
    } catch (err) {
      log.warn("fetchGateBlocks failed", err);
      if (!cleanedUpRef.current) {
        setGateBlocks([]);
        setGateTotalBlocks(0);
        setGateTotalEvals(null);
      }
    }
  }, []);

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

  // Reads only refs, so it is stable — `connectWs` (and therefore the WS
  // socket) no longer re-binds whenever a fetch callback identity changes.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    const anchor = Math.max(
      lastBatchStartedAtRef.current,
      lastBatchEndedAtRef.current
    );
    const delay = Math.max(
      REFETCH_DEBOUNCE_MS,
      MIN_BATCH_SPACING_MS - (Date.now() - anchor)
    );
    refetchTimerRef.current = setTimeout(() => {
      // Rule 3 applies to the WS path too, not just the poll: a hidden tab
      // with a live socket would otherwise keep running full batches off
      // `events.merge.*` all night. Suppressing here rather than at schedule
      // time loses nothing — `onVisibility` re-schedules on reveal.
      if (document.hidden) return;
      void fetchAllRef.current();
    }, delay);
  }, []);

  const fetchAll = useCallback(async () => {
    // Single-flight. Dropping the trigger outright would lose a WS update
    // that landed mid-batch, so remember it and run one more batch after —
    // bounded at one extra batch per completion, never a growing pile.
    if (inFlightRef.current) {
      rerunRef.current = true;
      return;
    }
    inFlightRef.current = true;
    lastBatchStartedAtRef.current = Date.now();
    try {
      // Each fetch* swallows its own errors, so this never rejects; the
      // `finally` is belt-and-braces so the guard cannot latch on.
      await Promise.all([
        fetchQueue(),
        fetchPrs(),
        fetchEconomics(),
        fetchSuggestions(),
        fetchGateBlocks(),
      ]);
    } finally {
      inFlightRef.current = false;
      lastBatchEndedAtRef.current = Date.now();
    }
    if (rerunRef.current && !cleanedUpRef.current) {
      rerunRef.current = false;
      scheduleRefetch();
    }
  }, [
    fetchQueue,
    fetchPrs,
    fetchEconomics,
    fetchSuggestions,
    fetchGateBlocks,
    scheduleRefetch,
  ]);

  useEffect(() => {
    fetchAllRef.current = fetchAll;
  }, [fetchAll]);

  const connectWs = useCallback(async (): Promise<void> => {
    if (cleanedUpRef.current || document.hidden) return;
    // Detach BEFORE closing. A superseded socket's `onclose` fires
    // asynchronously and would otherwise schedule a reconnect that closes the
    // healthy replacement — and since `onopen` zeroes the attempt counter,
    // that ping-pong never hits MAX_RECONNECT_ATTEMPTS.
    const prev = wsRef.current;
    if (prev) {
      prev.onopen = prev.onmessage = prev.onerror = prev.onclose = null;
      prev.close();
    }
    wsRef.current = null;
    const gen = ++connectGenRef.current;

    // The bridge authenticates the operator from the same session token
    // every other operations WS uses (`useDeviceStatusStream` is the
    // precedent) — the client-held bearer when present, else the
    // cookie-reading /api/v1/ws-token route.
    const token = await httpClient.getWebSocketToken();

    // Overtaken while awaiting the token — by another connect, by cleanup,
    // or by the tab hiding. Create nothing: a socket made here would be one
    // no cleanup can reach.
    if (
      gen !== connectGenRef.current ||
      cleanedUpRef.current ||
      document.hidden
    ) {
      return;
    }
    if (!token) {
      // No session → the bridge would refuse. The poll's `reviveWs` retries
      // every POLL_INTERVAL_MS, which is the right cadence for "signed out".
      log.debug("No WS token; merge pipeline stays on the poll");
      return;
    }

    const url = coordEventsWsUrl(WS_SUBSCRIPTION, token);
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
      // Resync after (re)connect — the snapshot catches anything missed
      // during the disconnect.
      scheduleRefetch();
    };

    ws.onmessage = (event) => {
      // The bridge also sends a channel-less `{"type":"keepalive"}` frame
      // on an idle upstream (finding 67329129) so a proxy on this leg
      // doesn't time the socket out. It carries no merge event and must
      // not trigger the hero's five-surface refetch — that would turn a
      // keepalive into a periodic full reload instead of a no-op.
      // Anything else is a real coord frame: merge events only signal
      // "something changed", so any non-keepalive message refetches for
      // the canonical state rather than trying to apply it incrementally.
      if (isKeepaliveFrame(event.data)) return;
      scheduleRefetch();
    };

    ws.onerror = (e) => {
      log.warn("WS error", e);
    };

    ws.onclose = () => {
      // `wsRef.current !== ws` means we have already been superseded.
      if (cleanedUpRef.current || wsRef.current !== ws) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        // Not terminal: the poll's `reviveWs` retries every POLL_INTERVAL_MS,
        // which restarts this ladder. This only ends the fast backoff burst.
        log.warn("WS fast-reconnect ladder exhausted; poll will keep retrying");
        return;
      }
      const delay = Math.min(1_000 * 2 ** reconnectAttemptsRef.current, 30_000);
      reconnectAttemptsRef.current += 1;
      reconnectRef.current = setTimeout(() => void connectWs(), delay);
    };
  }, [scheduleRefetch]);

  /**
   * Bring the socket back up if it is gone. Cancels any in-flight backoff
   * first — otherwise that timer fires later and tears down the socket we
   * just opened, discarding its `onopen` resync. Shared by the poll
   * supervisor and the tab-reveal handler so the two cannot drift apart.
   */
  const reviveWs = useCallback(() => {
    const ws = wsRef.current;
    // readyState <= OPEN covers CONNECTING(0) and OPEN(1) — both fine as-is.
    if (ws && ws.readyState <= WebSocket.OPEN) return;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    void connectWs();
  }, [connectWs]);

  useEffect(() => {
    cleanedUpRef.current = false;
    // A batch still settling from a previous mount (StrictMode remount) would
    // otherwise leave a stale rerun request armed against this one.
    rerunRef.current = false;
    let stopped = false;

    // Self-rescheduling chain rather than setInterval: the next tick is
    // armed only once the previous batch has SETTLED, so a slow backend can
    // never accumulate overlapping batches.
    const tick = async () => {
      if (stopped || cleanedUpRef.current) return;
      try {
        // `!inFlightRef.current` is load-bearing: a poll tick carries no
        // information, so it must NOT coalesce into `rerunRef` the way a WS
        // event does. If it did, a batch running longer than the poll gap
        // would arm a rerun that starts 250ms after it settles — collapsing
        // the gap to the debounce and making the request rate CLIMB with
        // latency, which is the incident's shape all over again.
        if (!document.hidden && !inFlightRef.current) {
          await fetchAllRef.current();
        }
      } catch (err) {
        // Rearming lives in `finally`: this is the ONLY rearm site, so an
        // escaped rejection here would silently kill the fallback poll for
        // the lifetime of the page.
        log.warn("poll tick failed", err);
      } finally {
        if (!stopped && !cleanedUpRef.current) {
          // Supervise the socket in `finally` for the same reason the rearm
          // lives here: a rejecting `fetchAll` must not also disable socket
          // recovery, or one broken surface takes down both transports.
          // `onclose`'s ladder gives up after MAX_RECONNECT_ATTEMPTS (~31s),
          // so this is what makes WS recovery unconditional.
          if (!document.hidden) reviveWs();
          pollTimerRef.current = setTimeout(
            () => void tick(),
            POLL_INTERVAL_MS
          );
        }
      }
    };

    // Hidden-gated like every other path into `fetchAll`: session-restore or
    // ctrl-clicking several dashboard tabs into the background would
    // otherwise each fire 5 concurrent requests before anything is on screen
    // — four such tabs is the entire 20-connection pool. `onVisibility`
    // fetches on first reveal, so nothing is lost.
    if (!document.hidden) void fetchAllRef.current();
    pollTimerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    void connectWs();

    // Re-reveal: resync at once, and open the socket if we never got one —
    // `connectWs` no-ops while hidden, so a tab that mounted in the
    // background would otherwise sit with no live transport.
    const onVisibility = () => {
      if (document.hidden || cleanedUpRef.current || stopped) return;
      // Via scheduleRefetch, not a direct call: rapid hide/reveal churn
      // (alt-tab, a monitor sleeping, window-manager events) would otherwise
      // issue an unthrottled batch per reveal.
      scheduleRefetch();
      reviveWs();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      cleanedUpRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      }
    };
  }, [connectWs, scheduleRefetch, reviveWs]);

  // Merged rows ride their OWN slow timer, and only while the caller wants
  // them. Deliberately not folded into `fetchAll`: that is the 2s loop, and
  // the merged query is the expensive one (see MERGED_POLL_INTERVAL_MS).
  // Leaving the Merged/All PRs tabs clears the timer; the last rows stay in
  // state so returning to the tab renders instantly while the refetch runs.
  //
  // The same three load rules as the main batch (see the header): single-flight,
  // a gap measured from COMPLETION, and no polling from a hidden tab. This read
  // holds a backend DB connection for 14-21s, so it is the one that most needs
  // them — it used to run on a bare `setInterval`, which stacks requests when
  // coord slows down, and polled from tabs nobody was looking at.
  // The in-flight read and the time of the last completed one are owned by the
  // HOOK, not by any one effect run. Owning them per effect run is what let
  // single-flight break: the effect re-runs when `includeMerged` flips (a tab
  // click away from All PRs and back) and under StrictMode, and each run's own
  // "I am not in flight" state started a second 14-21s read while the first was
  // still pinning its DB connection. A new run now ADOPTS the read that is
  // already out.
  //
  // The minimum age is the rate floor. Single-flight caps concurrency, not
  // rate: without it, re-showing the tab or flipping tabs every few seconds
  // starts one read per event. Completion time is recorded on FAILURE too, so a
  // struggling coord is not re-asked on every reveal.
  //
  // KNOWN LIMIT: this is per hook INSTANCE. Leaving the page mid-read and coming
  // back inside the read's 14-21s mounts a new instance with fresh refs, which
  // starts its own read while the first still holds its connection. Sharing the
  // read across mounts needs a module-level store with subscribers (the adopted
  // read would otherwise publish into an unmounted instance's state), which is a
  // larger change than this one.
  const readMergedIfStale = useCallback((): Promise<void> => {
    if (mergedReadRef.current) return mergedReadRef.current;
    // A NEGATIVE age (the wall clock stepped backwards: resume from sleep, NTP)
    // is stale, not fresh — otherwise reads stay suppressed until the clock
    // catches up to where it was.
    const age = Date.now() - mergedDoneAtRef.current;
    if (age >= 0 && age < MERGED_MIN_AGE_MS) return Promise.resolve();
    // Only one read is ever out, and only this promise sets the ref, so its
    // own completion is the only thing that clears it.
    const read: Promise<void> = fetchMergedPrs().finally(() => {
      mergedReadRef.current = null;
      mergedDoneAtRef.current = Date.now();
    });
    mergedReadRef.current = read;
    return read;
  }, [fetchMergedPrs]);

  useEffect(() => {
    if (!includeMerged) return;
    let stopped = false;
    // This run's chain is awaiting a read. A second entrance (the reveal
    // handler) must not start a second chain: two chains reschedule twice.
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      running = true;
      try {
        if (!stopped && !document.hidden) await readMergedIfStale();
      } finally {
        running = false;
        // Re-armed in the `finally`: a throw from the read must not end polling
        // for the life of the page (the main chain's own comment says the same).
        if (!stopped) {
          timer = setTimeout(() => void tick(), MERGED_POLL_INTERVAL_MS);
        }
      }
    };
    void tick();
    // A tab that was hidden skipped its ticks; refresh the moment it is seen
    // (subject to the minimum age), rather than showing rows up to a poll old
    // for a full extra interval.
    const onVisibility = () => {
      if (document.hidden || stopped || running) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [includeMerged, readMergedIfStale]);

  return {
    proposals,
    prs,
    mergedPrs,
    mergedError,
    mergedCount,
    economicsByRepo,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    gateTotalEvals,
    error,
    suggestionBusy,
    onSuggestionAction,
    // Debounced manual refresh — used by per-row operator actions (e.g. the
    // draft-state toggle) to pull the pipeline forward after a mutation. Stable
    // identity (reads only refs), so passing it down never re-binds children.
    refetch: scheduleRefetch,
  };
}
