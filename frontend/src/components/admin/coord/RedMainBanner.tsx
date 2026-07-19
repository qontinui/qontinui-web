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
 * alert row resolves. Read-only in Phase 1: the "Spawn fix session"
 * button arrives with the auto-spawn phase (Phase 4).
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { CoordAlertRow } from "@/components/admin/coord/AlertCard";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
/** Same cadence as the coord alerts page. */
const POLL_INTERVAL_MS = 10_000;

const RED_MAIN_KEY_PREFIX = "red_main:";

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

export function RedMainBanner() {
  const [reds, setReds] = useState<RedMainAlert[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const body = await httpClient.get<unknown>(
        `${API}/alerts?include_resolved=false`
      );
      // Tolerate both `{alerts: [...]}` and bare-list shapes (same as the
      // alerts page).
      const alerts = Array.isArray(body)
        ? body
        : ((body as { alerts?: CoordAlertRow[] })?.alerts ?? []);
      setReds(parseRedMainAlerts(alerts));
    } catch {
      // Best-effort: keep the last known state on a transient fetch error
      // — a flaky poll must neither flash the banner away during a real
      // outage nor surface its own error UI here (the alerts page does
      // that). The next poll retries.
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  if (reds.length === 0) return null;

  const nowMs = Date.now();
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
        </div>
      ))}
    </div>
  );
}

export default RedMainBanner;
