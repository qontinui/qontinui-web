"use client";

/**
 * /admin/coord/releases — Runner publishing (GitHub Releases) dashboard.
 *
 * Plan `twin-runner-release-surface` Phase 2 — the operator read surface over
 * coord's release observer: runner installer publishing is the GitHub-Releases
 * surface of the existing Ξ_Release sub-space. This page lists observed
 * releases newest-first with the drift verdict (in sync / in flight / stale /
 * stuck draft / rolled back), the Windows hard-gate asset presence
 * (`-setup.exe` + `latest.json`), CI/build state, published_at, and
 * draft/prerelease flags — so a release silently stuck as a draft (the
 * v1.0.0/v1.0.1 case) is an observable drift instead of a manual discovery.
 *
 * Coord base URL + operator auth are reused exactly as the deploys/lands
 * siblings: `httpClient.get` (via `runnerReleasesService`) hits the web
 * backend at `/api/v1/operations/releases`, which forwards the operator's
 * Cognito bearer to coord. The frontend never talks to coord directly.
 *
 * The list auto-refreshes on a 30s poll (mirrors the deploys page) — a release
 * legitimately sits `in flight` for the ~2h runner build, and the poll shows
 * it settle to `in sync` (or a stuck-draft `failed_deploy`) without a manual
 * refresh.
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Runner releases`
 *   wrapper is gone; the observed target moved into the health strip's detail.
 * - **R1** — a `<HealthStrip>` derived from the rows ALREADY FETCHED opens the
 *   page. No second request.
 * - **R6** — `<FilterTabs>` over the release STATE, with live counts. The repo
 *   filter beside it stays an input because it is SERVER-side (debounced into
 *   coord's `repo=` parameter); the state axis is client-side over the window
 *   already fetched, so every one of its counts is a real measurement.
 * - **R2/R5** — one release is one `<ReleaseRow>` line; detail expands in
 *   place, and the card's separate drill-down toggle is gone (one expansion
 *   affordance per record, not two).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import { ReleaseRow } from "@/components/admin/coord/ReleaseRow";
import {
  RELEASE_ATTENTION_BY_STATE,
  releaseState,
} from "@/components/admin/coord/releaseStatus";
import {
  runnerReleasesService,
  type ReleaseHistoryEntry,
} from "@/services/runner-releases-service";

const POLL_INTERVAL_MS = 30_000;
const REPO_DEBOUNCE_MS = 400;

type TabId = "all" | "attention" | "in-flight";

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch. `loaded=false` returns EARLY with badge labels that spell the dash
 * literally: `<HealthStrip>` renders `label` verbatim, so a null label renders
 * NOTHING rather than `–`.
 */
function deriveReleasesHealth(
  rows: ReleaseHistoryEntry[],
  loaded: boolean,
  target: string | null,
  error: string | null
): {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
} {
  // A failed read leaves the counts UNKNOWN, and "0 stuck releases" read off a
  // request that never answered is the `silent-empty-is-unknown` mistake with
  // a badge attached — the same reading the dash rule refuses for a tab count.
  if (!loaded || error) {
    return {
      level: error ? "red" : "amber",
      headline: error
        ? "coord did not answer — the counts below are unknown, not zero"
        : "Waiting for coord…",
      detail: error ?? "counts appear once the release history arrives",
      badges: [
        { key: "total", label: <>releases –</>, tone: "muted" },
        { key: "stuck", label: <>stuck –</>, tone: "muted" },
      ],
    };
  }

  let stuck = 0;
  let inFlight = 0;
  let unknown = 0;
  let inSync = 0;
  for (const r of rows) {
    const state = releaseState(r);
    if (RELEASE_ATTENTION_BY_STATE[state] === "author") stuck += 1;
    if (state === "in_flight") inFlight += 1;
    if (state === "unknown") unknown += 1;
    if (state === "in_sync") inSync += 1;
  }

  const level: HealthStripLevel =
    stuck > 0 ? "red" : inFlight > 0 || unknown > 0 ? "amber" : "green";
  return {
    level,
    headline:
      stuck > 0
        ? `${stuck} release${stuck === 1 ? "" : "s"} stuck — nothing publishes these but a human`
        : rows.length === 0
          ? "No observed releases in this window"
          : inFlight > 0
            ? `${inFlight} in flight; nothing stuck`
            : "Every observed release is in sync",
    detail: [
      `${inSync} in sync`,
      unknown > 0 ? `${unknown} descriptor${unknown === 1 ? "" : "s"} coord could not read` : null,
      target ? `target ${target}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    badges: [
      { key: "total", label: <>releases {rows.length}</>, tone: "muted" },
      {
        key: "stuck",
        label: <>stuck {stuck}</>,
        tone: stuck > 0 ? "attention" : "muted",
        title:
          "stale, stuck draft or rolled back — no workflow and no retry clears any of these",
      },
      { key: "in-flight", label: <>in flight {inFlight}</>, tone: "default" },
      {
        key: "unknown",
        label: <>unreadable {unknown}</>,
        tone: "muted",
        title:
          "a drift descriptor this build cannot read, usually a dark observation — unknown, not fine",
      },
    ],
  };
}

export default function CoordReleasesPage() {
  const [repoFilter, setRepoFilter] = useState("");
  // The repo actually fetched — debounced off `repoFilter` so typing a repo
  // name doesn't fire a coord round-trip (and reset the poll) per keystroke.
  const [appliedRepo, setAppliedRepo] = useState("");
  // Bumped by the refresh button / Enter to force an immediate reload even when
  // `appliedRepo` is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [releases, setReleases] = useState<ReleaseHistoryEntry[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");

  // Debounce the filter → applied repo.
  useEffect(() => {
    const id = setTimeout(
      () => setAppliedRepo(repoFilter.trim()),
      REPO_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [repoFilter]);

  // Apply the current filter immediately (refresh button / Enter), bypassing
  // the debounce and forcing a reload via the nonce.
  const refreshNow = useCallback(() => {
    setAppliedRepo(repoFilter.trim());
    setReloadNonce((n) => n + 1);
  }, [repoFilter]);

  // Fetch + poll for the applied repo. A per-run `ignore` guard drops a stale
  // response, so an earlier slow request can never overwrite a newer one.
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const body = await runnerReleasesService.list({
          limit: 100,
          ...(appliedRepo ? { repo: appliedRepo } : {}),
        });
        if (ignore) return;
        setReleases(body.history ?? []);
        setTarget(body.target ?? null);
        setError(body.coord_error ?? null);
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ignore) setLoaded(true);
      }
    };
    setLoaded(false);
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [appliedRepo, reloadNonce]);

  // Newest-first by observed_at (coord already sorts; guarded here so the
  // contract is explicit and stable regardless of coord ordering).
  const sorted = useMemo(() => {
    return [...releases].sort((a, b) =>
      (b.observed_at ?? "").localeCompare(a.observed_at ?? "")
    );
  }, [releases]);

  const counts = useMemo(() => {
    let attention = 0;
    let inFlight = 0;
    for (const r of sorted) {
      const state = releaseState(r);
      if (RELEASE_ATTENTION_BY_STATE[state] === "author") attention += 1;
      if (state === "in_flight") inFlight += 1;
    }
    return { all: sorted.length, attention, inFlight };
  }, [sorted]);

  const shown = useMemo(() => {
    if (tab === "all") return sorted;
    if (tab === "in-flight") {
      return sorted.filter((r) => releaseState(r) === "in_flight");
    }
    return sorted.filter(
      (r) => RELEASE_ATTENTION_BY_STATE[releaseState(r)] === "author"
    );
  }, [sorted, tab]);

  const health = useMemo(
    () => deriveReleasesHealth(sorted, loaded, target, error),
    [sorted, loaded, target, error]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-releases-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-releases-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs<TabId>
          tabs={[
            // `null` until the first answer commits — `–`, never `0` (R6).
            { id: "all", label: "All", count: loaded ? counts.all : null },
            {
              id: "attention",
              label: "Needs a human",
              count: loaded ? counts.attention : null,
              attention: counts.attention > 0,
            },
            {
              id: "in-flight",
              label: "In flight",
              count: loaded ? counts.inFlight : null,
            },
          ]}
          active={tab}
          onChange={setTab}
          testIdPrefix="coord-releases-tab"
        />
        <Input
          placeholder="Filter by repo (e.g. qontinui/qontinui-runner)"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") refreshNow();
          }}
          className="w-72 ml-auto"
          data-testid="coord-releases-repo-filter"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={refreshNow}
          data-testid="coord-releases-refresh"
          aria-label="Refresh releases"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <RecordList
        items={shown}
        itemKey={(e) =>
          `${e.tag ?? e.version ?? "rel"}-${e.observed_at ?? ""}`
        }
        loaded={loaded || releases.length > 0}
        skeletonRows={6}
        renderRow={(entry, ctx) => (
          <ReleaseRow
            entry={entry}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
          />
        )}
        empty={
          <p className="text-sm text-muted-foreground italic">
            {tab !== "all" ? (
              <>No observed releases in this window are {tab === "attention" ? "stuck" : "in flight"}.</>
            ) : (
              <>
                No observed releases
                {repoFilter.trim() ? ` for ${repoFilter.trim()}` : ""} yet. Coord
                observes GitHub Releases (webhook + poll) for the runner
                installer surface; a published release with its `-setup.exe` and
                `latest.json` assets appears here once observed.
              </>
            )}
          </p>
        }
      />
    </div>
  );
}
