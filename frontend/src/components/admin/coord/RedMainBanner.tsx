"use client";

/**
 * RedMainBanner — persistent, repo-scoped "main is RED" outage banner.
 *
 * Plan `2026-07-06-coord-red-main-auto-remediation-and-dashboard-alert.md`
 * Phase 1 (D2). A red main is a tenant-wide merge outage: coord refuses to
 * land ANY PR onto a red main (`block_reason_code: main-red`), so every
 * green PR in the repo is frozen until main is fixed. This banner is the
 * loud surface for that state on every coord console page.
 *
 * Driven SOLELY by the coord `red_main:<repo>` alert rows (single source
 * of truth): coord's `stuck_pr_watcher` detector 6 upserts one live
 * `coord.alerts` row per (repo, red-episode) and self-resolves it when
 * main goes green, so the banner can never disagree with coord. Fetched
 * over the same `/api/v1/operations/alerts` path the alerts page uses,
 * on the same poll cadence.
 *
 * Deliberately NOT dismissable and NOT a toast — it clears only when the
 * alert row resolves.
 *
 * Phase 4b adds the "Spawn fix session" button: an operator-driven
 * remediation lane that opens a visible fix session on the operator's
 * device for the repo's current red episode. Its enabled/disabled state is
 * derived SOLELY from the same alert row (`detail.fix_session` +
 * `detail.auto_fix_red_main`), so the button can never disagree with coord
 * about whether a remediation is already in flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { CoordAlertRow } from "@/components/admin/coord/alertStatus";
import { httpClient } from "@/services/service-factory";
import { redMainSpawnFixUrl } from "@/components/operations/utils";

const API = "/api/v1/operations";
/** Same cadence as the coord alerts page. */
const POLL_INTERVAL_MS = 10_000;

const RED_MAIN_KEY_PREFIX = "red_main:";
/** The `coord.alerts.kind` value the server-side filter narrows on. */
const RED_MAIN_KIND = "red_main";

/**
 * How many CONSECUTIVE empty polls it takes to clear the banner.
 *
 * 3 × 10s ≈ 30s of sustained emptiness. Low enough that a genuinely-fixed main
 * clears the banner promptly, high enough that a single evicted row (or an
 * un-upgraded coord dropping the `kind` filter on a churning 500-row window)
 * cannot. Measured 2026-08-14: the row survived 1 of 5 samples, so a
 * clear-on-first-empty banner was blind ~80% of the time.
 */
const EMPTY_POLLS_BEFORE_CLEAR = 3;

/**
 * How long a banner may go unconfirmed before it says so.
 *
 * Two intervals: one missed poll is ordinary jitter, two is a read path that
 * is not answering. Keeping the banner up is still right (a failed read is not
 * evidence main went green) — but an operator reading "main is RED" deserves
 * to know the claim is not being re-confirmed.
 */
const STALE_AFTER_MS = 2 * POLL_INTERVAL_MS;

const SPAWN_LABEL = "Spawn fix session";
const RETRY_LABEL = "Retry fix session";
const RUNNING_LABEL = "fix session running";
const SELF_HEAL_LABEL = "auto-rerun in flight";

/**
 * Normalized view of a red-main episode's remediation, parsed from the
 * alert row's `detail.fix_session`. That field is one of:
 *   - the string `"none"` — no remediation active;
 *   - an object `{state:"running"|"stalled"|"failed", agent_id, spawned_at}`
 *     — a spawned fix session in that state;
 *   - a self-heal string like `"auto-rerun-failed-jobs:<run_id>"` — coord's
 *     own infra-cancel re-run is in flight (any non-`"none"` string).
 * Anything missing or malformed normalizes to `{kind:"none"}` so a bad
 * payload can never hide the manual spawn control (coord still 409-guards a
 * duplicate).
 */
export interface FixSessionState {
  kind: "none" | "self_heal" | "running" | "stalled" | "failed";
  /** Spawned-session agent id (object form only). */
  agentId?: string;
  /** Spawn timestamp (object form only). */
  spawnedAt?: string;
  /** Raw self-heal reference, e.g. `auto-rerun-failed-jobs:<run_id>`. */
  raw?: string;
}

/** One red-main episode, parsed from its `coord.alerts` row. */
export interface RedMainAlert {
  alertKey: string;
  repo: string;
  /** Failing workflow names (alert `detail.workflows`). */
  workflows: string[];
  /** Open PRs blocked `main-red` behind the red main (blast radius). */
  blockedPrCount: number;
  /** Episode start — the alert row's own `first_seen_at`. */
  since?: string;
  /** Remediation state (alert `detail.fix_session`). */
  fixSession: FixSessionState;
  /**
   * Resolved `auto_fix_red_main` opt-in for this repo (alert
   * `detail.auto_fix_red_main`). When off (or absent), the operator is the
   * only remediation path, so the manual spawn button is always available.
   */
  autoFixRedMain: boolean;
}

/**
 * Normalize `detail.fix_session` into a {@link FixSessionState}. Pure —
 * exported for the vitest suite.
 */
export function parseFixSession(raw: unknown): FixSessionState {
  if (typeof raw === "string") {
    // Any non-"none" string is an active self-heal (auto-rerun reference).
    return raw === "none" ? { kind: "none" } : { kind: "self_heal", raw };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.state === "running" || o.state === "stalled" || o.state === "failed") {
      return {
        kind: o.state,
        agentId: typeof o.agent_id === "string" ? o.agent_id : undefined,
        spawnedAt: typeof o.spawned_at === "string" ? o.spawned_at : undefined,
      };
    }
  }
  // Missing / malformed → no active remediation (button stays available).
  return { kind: "none" };
}

/**
 * Derive the spawn button's base state (before any in-flight/optimistic
 * local override) from an alert. Pure — exported for the vitest suite.
 *
 * ENABLED when `auto_fix_red_main` is off for the repo (the operator is the
 * only lane), OR no remediation is active (`fix_session` = "none"), OR a
 * prior session has `stalled`/`failed` (a retry is warranted). DISABLED with
 * an explanatory label while a session is `running` or coord's own auto-rerun
 * is in flight.
 */
export function fixButtonState(a: RedMainAlert): {
  enabled: boolean;
  label: string;
} {
  if (!a.autoFixRedMain) return { enabled: true, label: SPAWN_LABEL };
  switch (a.fixSession.kind) {
    case "none":
      return { enabled: true, label: SPAWN_LABEL };
    case "stalled":
    case "failed":
      return { enabled: true, label: RETRY_LABEL };
    case "running":
      return { enabled: false, label: RUNNING_LABEL };
    case "self_heal":
      return { enabled: false, label: SELF_HEAL_LABEL };
  }
}

/** Compact display form of a fix-session agent id. */
export function truncateAgentId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

/**
 * Extract the live red-main episodes from a `coord.alerts` slice: rows
 * whose `alert_key` starts with `red_main:` and are unresolved. Repo
 * falls back to the alert-key suffix when the detail is missing, so a
 * malformed detail payload can never hide an episode. Pure — exported
 * for the vitest suite.
 */
export function parseRedMainAlerts(alerts: unknown): RedMainAlert[] {
  if (!Array.isArray(alerts)) return [];
  const out: RedMainAlert[] = [];
  for (const a of alerts as CoordAlertRow[]) {
    if (!a || typeof a.alert_key !== "string") continue;
    if (!a.alert_key.startsWith(RED_MAIN_KEY_PREFIX)) continue;
    if (a.resolved_at) continue;
    const detail = (a.detail ?? {}) as Record<string, unknown>;
    const repo =
      typeof detail.repo === "string" && detail.repo.length > 0
        ? detail.repo
        : a.alert_key.slice(RED_MAIN_KEY_PREFIX.length);
    const workflows = Array.isArray(detail.workflows)
      ? detail.workflows.filter((w): w is string => typeof w === "string")
      : [];
    const rawCount = detail.blocked_pr_count;
    const blockedPrCount =
      typeof rawCount === "number" && Number.isFinite(rawCount)
        ? rawCount
        : 0;
    out.push({
      alertKey: a.alert_key,
      repo,
      workflows,
      blockedPrCount,
      since: a.first_seen_at,
      fixSession: parseFixSession(detail.fix_session),
      autoFixRedMain: detail.auto_fix_red_main === true,
    });
  }
  // Stable per-repo order so the banner stack never reshuffles between polls.
  out.sort((x, y) => x.repo.localeCompare(y.repo));
  return out;
}

/**
 * Compact "how long has this been red" label from the row's
 * `first_seen_at`. Pure (injectable `nowMs`) — exported for the vitest
 * suite. Unparseable input echoes back verbatim rather than hiding the
 * episode start entirely.
 */
export function sinceLabel(iso: string | undefined, nowMs: number): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The banner headline (D2 wording). Pure — exported for the vitest
 * suite.
 */
export function redMainHeadline(a: RedMainAlert, nowMs: number): string {
  const prs = a.blockedPrCount === 1 ? "PR" : "PRs";
  const label = sinceLabel(a.since, nowMs);
  const since = a.since && label !== a.since ? ` since ${label} ago` : "";
  return (
    `🔴 ${a.repo} main is RED${since} — ` +
    `${a.blockedPrCount} ${prs} blocked, no merges will land until fixed`
  );
}

/**
 * Best-effort extraction of a human message from coord's error response.
 * Coord's 409 body is JSON like `{"error":"fix session already running"}`;
 * fall back to the raw text (or a status line) when it isn't parseable.
 */
function errorMessage(status: number, body: string): string {
  const text = body.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const msg = parsed.error ?? parsed.detail ?? parsed.message;
      if (typeof msg === "string" && msg.length > 0) return msg;
    } catch {
      // fall through to raw text
    }
  }
  return text.length > 0 ? text : `HTTP ${status}`;
}

/**
 * The operator-driven "Spawn fix session" control for one red episode.
 * POSTs through the web→coord operations proxy (same mechanism as the
 * sibling merge-orchestration mutation controls). On success it optimistically
 * shows the running state + truncated agent id until the next alert poll
 * reflects the persisted `fix_session`; on a 409/error it surfaces coord's
 * message inline and re-enables.
 */
function SpawnFixButton({ alert }: { alert: RedMainAlert }) {
  const [submitting, setSubmitting] = useState(false);
  const [spawnedAgentId, setSpawnedAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await httpClient.fetch(redMainSpawnFixUrl(alert.repo), {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(errorMessage(res.status, body));
      }
      const data = (await res.json()) as { agent_id?: string };
      // Optimistic: the alert row won't carry the new `fix_session` until the
      // next poll, so pin the running state locally in the meantime.
      setSpawnedAgentId(typeof data.agent_id === "string" ? data.agent_id : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [alert.repo]);

  // Optimistic success — show the running badge + truncated id.
  if (spawnedAgentId !== null) {
    return (
      <span
        className="badge badge-warning"
        data-testid="red-main-fix-running"
        role="status"
      >
        {RUNNING_LABEL}
        {spawnedAgentId ? ` · ${truncateAgentId(spawnedAgentId)}` : ""}
      </span>
    );
  }

  const base = fixButtonState(alert);
  const disabled = submitting || !base.enabled;
  const label = submitting ? "Spawning…" : base.label;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-primary btn-sm"
        onClick={handleClick}
        disabled={disabled}
        aria-disabled={disabled}
        data-testid="red-main-spawn-fix"
        title={
          base.enabled
            ? undefined
            : base.label === SELF_HEAL_LABEL
              ? "Coord's automatic re-run is already remediating this episode."
              : "A fix session is already running for this red episode."
        }
      >
        {submitting && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {label}
      </button>
      {error && (
        <span
          className="badge badge-warning"
          data-testid="red-main-spawn-fix-error"
          role="alert"
        >
          {error}
        </span>
      )}
    </span>
  );
}

export function RedMainBanner() {
  const [reds, setReds] = useState<RedMainAlert[]>([]);
  /**
   * Consecutive polls that came back with no `red_main` row. See
   * {@link EMPTY_POLLS_BEFORE_CLEAR} — the banner clears only once this
   * crosses the threshold, so one evicted or dropped answer cannot blank it.
   */
  const emptyPolls = useRef(0);
  /**
   * Guards against overlapping polls. A read that outlives the 10s interval
   * would otherwise have a second one launched on top of it, and two answers
   * landing out of order double-count (or reset) the empty streak — the state
   * the streak protects would then turn on request latency.
   */
  const inFlight = useRef(false);
  /**
   * When coord last CONFIRMED the banner's content, and the clock that ages
   * it. A failed poll deliberately does not advance the streak (a read outage
   * is not evidence main went green), which is right — but it also means the
   * banner can keep asserting "main is RED" off an hour-old answer with
   * nothing on screen saying so. `nowMs` ticks only while the banner is up.
   */
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // TARGETED, not the whole rollup. Measured 2026-08-14: coord orders the
      // unfiltered rollup by `last_seen_at DESC` under a hard 500-row cap, and
      // every watcher re-stamps `last_seen_at` on its own tick — so the served
      // window spanned as little as 7.2s and the single `red_main` row
      // survived only 1 of 5 consecutive samples. A `kind`-filtered query
      // cannot be evicted by another watcher's tick. An un-upgraded coord
      // ignores the unknown param and returns the old unfiltered rollup, which
      // `parseRedMainAlerts` already filters — so this degrades to exactly the
      // previous behaviour rather than to an empty banner.
      const body = await httpClient.get<unknown>(
        `${API}/alerts?include_resolved=false&kind=${RED_MAIN_KIND}`
      );
      // Tolerate both `{alerts: [...]}` and bare-list shapes (same as the
      // alerts page).
      const alerts = Array.isArray(body)
        ? body
        : ((body as { alerts?: CoordAlertRow[] })?.alerts ?? []);
      const parsed = parseRedMainAlerts(alerts);
      // The answer arrived, so what the banner shows is confirmed as of NOW —
      // whether it confirmed a red main or an empty result.
      const at = Date.now();
      setLastSuccessAt(at);
      setNowMs(at);
      if (parsed.length > 0) {
        emptyPolls.current = 0;
        setReds(parsed);
        return;
      }
      // KEEP-LAST-KNOWN. An empty answer is ambiguous: main went green, OR the
      // row was evicted / the filter was dropped by an older coord. Clearing a
      // tenant-wide merge-outage banner on that ambiguity is the M2 defect —
      // require the emptiness to persist before believing it.
      emptyPolls.current += 1;
      if (emptyPolls.current >= EMPTY_POLLS_BEFORE_CLEAR) setReds([]);
    } catch {
      // Best-effort: keep the last known state on a transient fetch error
      // — a flaky poll must neither flash the banner away during a real
      // outage nor surface its own error UI here (the alerts page does
      // that). The next poll retries. A failed poll is NOT an empty one, so
      // the streak is left untouched — and `lastSuccessAt` is NOT advanced,
      // which is what makes the staleness note appear.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => {
      // Skip the tick while nobody is looking; catch up on the way back.
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      fetchData();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  // Age the "as of" clock while the banner is up, so a stalled read path shows
  // as stale instead of quietly freezing at its last confirmed value.
  const banner = reds.length > 0;
  useEffect(() => {
    if (!banner) return;
    const id = setInterval(() => setNowMs(Date.now()), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [banner]);

  if (reds.length === 0) return null;

  const staleMs =
    lastSuccessAt === null ? 0 : Math.max(0, nowMs - lastSuccessAt);
  const stale = staleMs > STALE_AFTER_MS;

  return (
    <div data-testid="red-main-banner" className="shrink-0">
      {reds.map((a) => (
        <div
          key={a.alertKey}
          role="alert"
          data-testid="red-main-banner-row"
          // Deep-red bar + white text (~10:1, passes WCAG AAA), NOT
          // `bg-destructive text-destructive-foreground`: this app's theme
          // has no `--destructive-foreground` token (see globals.css — the
          // design system dropped it, which is why shadcn's own Badge
          // destructive variant hardcodes `text-white`), so that class
          // resolved to nothing and the headline fell back to whatever it
          // inherited — unreadable against the red fill. White on the raw
          // `--destructive` (#e5534b) is only 3.7:1 and fails AA for 14px
          // text anyway, so the surface is darkened rather than just
          // re-colouring the text. The bright border + icon keep it loud.
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-6 py-2 bg-red-900 text-white border-b-2 border-red-500"
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-red-300"
            aria-hidden
          />
          <span className="text-sm font-semibold">
            {redMainHeadline(a, nowMs)}
          </span>
          {a.workflows.length > 0 && (
            <span className="text-xs font-mono text-red-100">
              failing: {a.workflows.join(", ")}
            </span>
          )}
          {stale && lastSuccessAt !== null && (
            // The banner stays up on a read outage BY DESIGN, but it must not
            // pass an unconfirmed claim off as a live one.
            <span
              className="text-xs text-red-200 italic"
              data-testid="red-main-stale"
              title="coord has not confirmed this alert since then — the read path is failing, so the banner is showing its last known state"
            >
              (as of{" "}
              {sinceLabel(new Date(lastSuccessAt).toISOString(), nowMs)} ago)
            </span>
          )}
          <span className="ml-auto">
            <SpawnFixButton alert={a} />
          </span>
        </div>
      ))}
    </div>
  );
}

export default RedMainBanner;
