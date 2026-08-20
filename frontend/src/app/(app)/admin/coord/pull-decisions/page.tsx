"use client";

/**
 * /admin/coord/pull-decisions — the `repo_pull` decision activity feed.
 *
 * Plan `2026-05-30-coord-pull-decision-ui.md` Phase 2 (Feature A).
 *
 * Renders a reverse-chronological feed of `PullDecisionRow`s polled from
 * coord (via the web backend proxy) every 10s. Optional `?device_id=` and
 * `?repo=` filters seed the view from cross-links (e.g. the TreeCard verdict
 * badge links here).
 *
 * Empty-state note (plan §4.3): resolution rows are written ONLY when a
 * runner/agent requests the `repo_pull` verdict (the executor path, off by
 * default via `COORD_PULL_EXECUTOR_ENABLED`) or via a manual
 * `coord_request_policy` call. The pull-decision *watcher* emits
 * `repo_pull_hold` *alerts* (see /admin/coord/alerts), not resolution rows —
 * so an empty feed alongside active hold alerts is expected until the
 * executor runs.
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Pull decisions`
 *   wrapper is gone. `coord/layout.tsx` already renders the console `<h1>`.
 * - **R1** — a `<HealthStrip>` derived from the rows ALREADY FETCHED opens the
 *   page. No second request.
 * - **R2/R5** — one decision is one `<PullDecisionRow>` line; detail expands
 *   in place (`<RecordList>` keeps one open at a time).
 *
 * **No `<FilterTabs>`, deliberately.** This page's two filters (`device_id`,
 * `repo`) are SERVER-side — the values go to coord as query parameters and
 * change what is fetched — so a tab's count would be `–` for every option but
 * the one selected, which R6's dash rule permits but which is a strictly worse
 * control than the two inputs. Same call, same reason, as `/plans` keeping its
 * status `<Select>`. The one client-side axis (verdict) has its counts in the
 * health strip instead, which is where R1 puts a measurement of the whole
 * surface.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  HealthStrip,
  RecordList,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import { PullDecisionRow } from "@/components/admin/coord/PullDecisionRow";
import {
  PULL_ATTENTION_BY_VERDICT,
  derivePullDecisionStatus,
  type PullDecisionRow as PullDecisionRowData,
} from "@/components/admin/coord/pullDecisionStatus";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

interface PullDecisionsResponse {
  resolutions?: PullDecisionRowData[];
  count?: number;
}

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch. `loaded=false` returns EARLY with badge labels that spell the dash
 * literally: `<HealthStrip>` renders `label` verbatim, so a null label renders
 * NOTHING rather than `–`.
 */
function derivePullHealth(
  rows: PullDecisionRowData[],
  loaded: boolean
): {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
} {
  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the decision feed arrives",
      badges: [
        { key: "total", label: <>decisions –</>, tone: "muted" },
        { key: "diverged", label: <>diverged –</>, tone: "muted" },
      ],
    };
  }

  let diverged = 0;
  let holding = 0;
  let noOutcome = 0;
  for (const r of rows) {
    // Through the ROW's own derivation, not a second classification of the
    // raw verdict: a divergence with a recorded outcome is `diverged_handled`
    // and calm, and a strip that counted it as red would turn the page red
    // over finished work while every row on it read calm.
    const kind = derivePullDecisionStatus(r).kind;
    if (PULL_ATTENTION_BY_VERDICT[kind] === "author") diverged += 1;
    else if (kind === "hold") holding += 1;
    if (!r.outcome?.chosen_option) noOutcome += 1;
  }

  const level: HealthStripLevel =
    diverged > 0 ? "red" : holding > 0 ? "amber" : "green";
  return {
    level,
    headline:
      diverged > 0
        ? `${diverged} unresolved divergence${diverged === 1 ? "" : "s"} — a human picks the winning side`
        : rows.length === 0
          ? "No pull decisions in this window"
          : holding > 0
            ? `${holding} on hold; nothing diverged`
            : "Every decision in this window is clear",
    detail:
      rows.length === 0
        ? "resolution rows are written only when the executor runs"
        : `${noOutcome} of ${rows.length} have no recorded outcome yet`,
    badges: [
      { key: "total", label: <>decisions {rows.length}</>, tone: "muted" },
      {
        key: "diverged",
        label: <>diverged {diverged}</>,
        tone: diverged > 0 ? "attention" : "muted",
        title:
          "diverged with no outcome reported — nothing downstream reconciles a diverged checkout",
      },
      {
        key: "holding",
        label: <>on hold {holding}</>,
        tone: "default",
        title: "coord deferred the pull; the hold lapses on its own",
      },
      {
        key: "no-outcome",
        label: <>no outcome {noOutcome}</>,
        tone: "muted",
        title:
          "the executor writes the outcome back only when it runs — this is unknown, not 'nothing happened'",
      },
    ],
  };
}

export default function CoordPullDecisionsPage() {
  const searchParams = useSearchParams();
  const initialDeviceId = searchParams?.get("device_id") ?? "";
  const initialRepo = searchParams?.get("repo") ?? "";

  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [repo, setRepo] = useState(initialRepo);
  const [data, setData] = useState<PullDecisionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (deviceId) qs.set("device_id", deviceId);
      if (repo) qs.set("repo", repo);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      // Tolerate both the `{resolutions: [...]}` envelope and a bare array.
      const body = await httpClient.get<unknown>(
        `${API}/coord/pull-decisions${suffix}`
      );
      const normalized: PullDecisionsResponse = Array.isArray(body)
        ? { resolutions: body as PullDecisionRowData[] }
        : (body as PullDecisionsResponse);
      setData(normalized);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [deviceId, repo]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const rows = useMemo(() => data?.resolutions ?? [], [data]);
  const loaded = data !== null;
  const health = useMemo(() => derivePullHealth(rows, loaded), [rows, loaded]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-pull-decisions-page"
    >
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-pull-decisions-health"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="device_id (UUID)"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value.trim())}
          className="max-w-xs font-mono text-xs"
          data-testid="coord-pull-decisions-device-input"
        />
        <Input
          placeholder="repo (owner/name)"
          value={repo}
          onChange={(e) => setRepo(e.target.value.trim())}
          className="max-w-xs font-mono text-xs"
          data-testid="coord-pull-decisions-repo-input"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-pull-decisions-refresh"
          aria-label="Refresh pull decisions"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {/* `coord-pull-decisions` was the section `<Card>`'s testid; the card is
          gone (R9) and this list region is its equivalent — the thing on the
          page that IS "the pull decisions" (D4a). */}
      <div data-testid="coord-pull-decisions">
      <RecordList
        items={rows}
        itemKey={(r) => r.resolution_id}
        loaded={!(loading && !data)}
        skeletonRows={6}
        renderRow={(r, ctx) => (
          <PullDecisionRow
            row={r}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
          />
        )}
        empty={
          // Gated on `error` below: a failed fetch leaves the feed empty, and
          // asserting "nothing recorded" about a request that never answered is
          // the `silent-empty-is-unknown` mistake.
          error ? null : (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-pull-decisions-empty"
          >
            No pull decisions recorded yet — a resolution row is written only
            when a runner/agent requests the <code>repo_pull</code> verdict
            (<code>POST /coord/trees/pull-decision</code>, the executor path,
            off by default via <code>COORD_PULL_EXECUTOR_ENABLED</code>) or via
            a manual <code>coord_request_policy</code> call. The pull-decision{" "}
            <em>watcher</em> emits <code>repo_pull_hold</code> alerts (see{" "}
            <a className="underline" href="/admin/coord/alerts">
              /admin/coord/alerts
            </a>
            ), not resolution rows — so an empty feed with active hold alerts is
            expected until the executor runs.
          </p>
          )
        }
      />
      </div>
    </div>
  );
}
