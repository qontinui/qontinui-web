"use client";

/**
 * /admin/coord/lands — Push/Land effect-signatures operator dashboard.
 *
 * Plan `2026-05-31-push-land-action-effect-signatures-plan.md` Phase 4 —
 * pre-land impact preview surface. Three sections:
 *
 *   1. Preview panel: repo + PR inputs → pre-land PredictedLandEffect
 *      (cascade extent, conflicts, expected CI/deploys, main-merge overlap,
 *      inferred prior) + the risk verdict, prominently.
 *   2. Recent lands: declared lands newest-first with their composed
 *      verification verdict + per-dimension row + coverage.
 *   3. Calibration: per-dimension predictor precision/recall (nulls →
 *      "no data yet", never a fabricated 0/100%).
 *
 * Coord base URL + operator auth are reused exactly as the sibling coord
 * pages (git-ops / plans): `httpClient.get` hits the web backend at
 * `/api/v1/operations/*`, which forwards the operator's Cognito bearer to
 * coord (`settings.COORD_URL`) via the new lands proxy block in
 * `operations.py`. The frontend never talks to coord directly.
 *
 * The lands list + calibration auto-refresh on a 30s poll. The preview is
 * an explicit operator action (it targets a specific PR), so it does not
 * poll — re-run via the Preview button.
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the two page-level `<Card><CardHeader><CardTitle>` wrappers are
 *   gone; the recent-lands count moved into the health strip.
 * - **R1** — a `<HealthStrip>` derived from the lands ALREADY FETCHED opens
 *   the page. It reads NOTHING from the calibration poll: R1's load-bearing
 *   clause is "never a second fetch", and a health strip that summarised the
 *   precision response would make the page's headline depend on a request the
 *   operator can now switch off.
 * - **R2/R5** — one land is one `<LandRow>` line (`LandCard` was 601 lines
 *   rendering a four-line card); detail expands in place, and the cross-repo
 *   panel it lazily fetches is now part of that one detail rather than a
 *   second, independent expansion affordance.
 * - **R6** — `<FilterTabs>` over the verification verdict, with live counts.
 *   The repo filter stays an input: it is SERVER-side (coord's `repo=`).
 * - **R7** — sections 1 and 3 are `<CollapsiblePanel>`s. Section 3
 *   (`<LandPrecisionPanel>`) is the one the plan named: it rendered
 *   unconditionally and carried its OWN 30s poll, separate from the land list,
 *   so every visitor paid a calibration round-trip whether or not they came
 *   for a calibration table.
 *
 * **DISCLOSED BEHAVIOUR CHANGE (the one this wave makes deliberately).** The
 * calibration poll now lives in `<LandPrecisionSection>`, a child of that
 * panel, so collapsing the panel unmounts it and the poll STOPS — which is
 * what R7's *"a closed panel costs zero polling"* means and what the plan's
 * Wave-2 amendment asked for. The cadence is untouched (30s) and no endpoint
 * changed; what changed is whether the request fires at all while the panel is
 * shut. The panel's summary keeps showing the LAST value it saw, labelled as
 * such — it is not refreshed while collapsed, and saying otherwise would be
 * the same lie R6's dash rule forbids about a count.
 *
 * ## Why both panels default to OPEN
 *
 * `specs/pages/coord-lands/state-machine.derived.json` asserts
 * `coord-lands-preview-form` / `-repo` / `-pr` / `-btn` and
 * `coord-land-precision-table` (plus three of its header cells) in STATIC
 * states — that spec declares no transitions, so every criterion is evaluated
 * on page load. `<CollapsiblePanel>` unmounts its children when closed, so a
 * `defaultOpen={false}` here would take five committed criteria red, and the
 * derived specs are frozen (D4b): the answer to a genuinely-vanished target is
 * re-derivation from a fresh authed UI-Bridge snapshot, which is not available
 * in this session (Spec-CI's precondition is operator-held).
 *
 * So they open by default and PERSIST the operator's choice (`storageKey`).
 * That is R7 satisfied in the way that matters — the material is behind a
 * click, its summary stays visible while collapsed, and a collapsed panel
 * costs zero polling — while leaving the frozen spec green with no spec edit.
 * Flipping `defaultOpen` to `false` is a one-word change the moment Spec-CI is
 * runnable and the spec can be re-derived in the same PR.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Anchor, Gauge, RefreshCw, Search } from "lucide-react";
import {
  CollapsiblePanel,
  FilterTabs,
  HealthStrip,
  RecordList,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import { httpClient } from "@/services/service-factory";
import { LandRow } from "@/components/admin/coord/LandRow";
import type { LandRow as LandRowData } from "@/components/admin/coord/landTypes";
import {
  VERIFICATION_ATTENTION_BY_KIND,
  deriveVerificationStatus,
} from "@/components/admin/coord/verificationStatus";
import {
  LandPreviewPanel,
  type LandPreviewResponse,
} from "@/components/admin/coord/LandPreviewPanel";
import {
  LandPrecisionPanel,
  formatRate,
  type PrecisionResponse,
} from "@/components/admin/coord/LandPrecisionPanel";
import { useTenantDefaultRepo } from "@/components/operations/useTenantDefaultRepo";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

interface LandsResponse {
  lands?: LandRowData[] | null;
}

type TabId = "all" | "attention" | "unverified";

function needsAHuman(row: LandRowData): boolean {
  const kind = deriveVerificationStatus(row.verification).kind;
  return VERIFICATION_ATTENTION_BY_KIND[kind] === "author";
}

function isUnverified(row: LandRowData): boolean {
  return row.verification === null || row.verification === undefined;
}

/**
 * Pull the HTTP status out of an `httpClient` error. `httpClient.get` throws
 * `Error("GET <url> failed: <status> - <body>")`; we parse the status so the
 * preview can render 404/422/coord-down as distinct inline messages.
 */
function statusFromError(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/failed:\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

function previewErrorMessage(e: unknown, repo: string, pr: string): string {
  const status = statusFromError(e);
  if (status === 404) {
    return `PR not found: no open PR #${pr} in ${repo}.`;
  }
  if (status === 422) {
    return `Invalid input — check the repo (owner/name) and PR number.`;
  }
  if (status === 502) {
    return "Coord is not reachable. Try again shortly.";
  }
  if (status === 504) {
    return "Coord timed out building the preview. Try again shortly.";
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * The calibration section — the FETCH and its 30s poll, deliberately owned by
 * a component that only exists while the panel is open (R7).
 *
 * This is the whole point of the `/lands` R7 fix. `<CollapsiblePanel>` unmounts
 * its children when closed, so putting the poll here (rather than in the page,
 * where it lived) is what makes a closed panel cost zero requests. It reports
 * every answer UP to the page via `onData`, so the collapsed panel's summary
 * badge can keep showing the last value it saw — that value is a snapshot, not
 * a live reading, and the badge's title says so.
 */
function LandPrecisionSection({
  data,
  error,
  loadedAt,
  onData,
}: {
  data: PrecisionResponse | null;
  error: string | null;
  loadedAt: string | null;
  onData: (data: PrecisionResponse | null, error: string | null) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const body = await httpClient.get<PrecisionResponse>(
          `${API}/lands/precision`
        );
        if (!cancelled) onData(body, null);
      } catch (e) {
        if (!cancelled) {
          onData(null, e instanceof Error ? e.message : String(e));
        }
      }
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [onData]);

  return (
    <>
      {error && (
        <p className="text-sm text-destructive normal-case tracking-normal">
          Failed to load calibration: {error}
        </p>
      )}
      <LandPrecisionPanel data={data} loading={loadedAt === null} />
    </>
  );
}

/**
 * The page's health, derived from the LAND ROWS already on it (R1) — never a
 * second fetch, and deliberately not from the calibration response. `loaded`
 * false returns EARLY with badge labels that spell the dash literally:
 * `<HealthStrip>` renders `label` verbatim, so a null label renders NOTHING
 * rather than `–`.
 */
function deriveLandsHealth(
  rows: LandRowData[],
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
      detail: "counts appear once the recent-lands list arrives",
      badges: [
        { key: "total", label: <>lands –</>, tone: "muted" },
        { key: "attention", label: <>needs a human –</>, tone: "muted" },
      ],
    };
  }

  let attention = 0;
  let unverified = 0;
  let crossRepo = 0;
  for (const r of rows) {
    if (needsAHuman(r)) attention += 1;
    if (isUnverified(r)) unverified += 1;
    if (r.signature.correlation_id) crossRepo += 1;
  }

  const level: HealthStripLevel =
    attention > 0 ? "red" : unverified > 0 ? "amber" : "green";
  return {
    level,
    headline:
      attention > 0
        ? `${attention} land${attention === 1 ? "" : "s"} did not do what they declared`
        : rows.length === 0
          ? "No declared lands in this window"
          : unverified > 0
            ? `${unverified} awaiting the verifier; nothing failed`
            : "Every declared land verified clean",
    detail:
      rows.length === 0
        ? "a land declares itself when coord pushes or lands a branch"
        : `${crossRepo} fanned out to sibling repos`,
    badges: [
      { key: "total", label: <>lands {rows.length}</>, tone: "muted" },
      {
        key: "attention",
        label: <>needs a human {attention}</>,
        tone: attention > 0 ? "attention" : "muted",
        title:
          "a failure or a contradiction — nothing downstream retries either one",
      },
      {
        key: "unverified",
        label: <>unverified {unverified}</>,
        tone: "default",
        title: "declared, and the verifier has not answered yet",
      },
      { key: "cross-repo", label: <>cross-repo {crossRepo}</>, tone: "muted" },
    ],
  };
}

export default function CoordLandsPage() {
  // ---- Preview state ----
  const [repoInput, setRepoInput] = useState("");
  const [prInput, setPrInput] = useState("");

  // Pre-fill the preview repo with the ACTIVE tenant's first registered repo
  // (never a hardcoded operator repo). Convenience only — the preview still
  // requires an explicit PR number + Preview click, so seeding fires no fetch.
  // The recent-lands filter below stays empty so it shows ALL of the tenant's
  // lands by default (tenant-scoped server-side).
  const { defaultRepo } = useTenantDefaultRepo();
  const seededRepoRef = useRef(false);
  useEffect(() => {
    if (seededRepoRef.current || repoInput) return;
    if (defaultRepo) {
      seededRepoRef.current = true;
      setRepoInput(defaultRepo);
    }
  }, [defaultRepo, repoInput]);
  const [preview, setPreview] = useState<LandPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ---- Recent lands state ----
  const [landsRepoFilter, setLandsRepoFilter] = useState("");
  const [lands, setLands] = useState<LandRowData[]>([]);
  const [landsLoading, setLandsLoading] = useState(true);
  const [landsLoaded, setLandsLoaded] = useState(false);
  const [landsError, setLandsError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");

  // ---- Calibration state ----
  //
  // Held HERE, written by `<LandPrecisionSection>` below, so the collapsed
  // panel can still show the last value it saw (R7's "its signal does not
  // collapse"). The FETCH lives in the child, so a closed panel costs nothing.
  const [precision, setPrecision] = useState<PrecisionResponse | null>(null);
  const [precisionError, setPrecisionError] = useState<string | null>(null);
  const [precisionAt, setPrecisionAt] = useState<string | null>(null);

  // Stable identity: `<LandPrecisionSection>`'s effect depends on it, and a
  // new function each render would restart its poll on every page render.
  const handlePrecision = useCallback(
    (body: PrecisionResponse | null, err: string | null) => {
      if (body) setPrecision(body);
      setPrecisionError(err);
      setPrecisionAt(new Date().toLocaleTimeString());
    },
    []
  );

  // ---- Preview action ----
  const runPreview = useCallback(async () => {
    const repo = repoInput.trim();
    const pr = prInput.trim();
    if (!repo || !pr) {
      setPreviewError("Enter a repo (owner/name) and a PR number.");
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const qs = new URLSearchParams({ repo, pr });
      const body = await httpClient.get<LandPreviewResponse>(
        `${API}/lands/preview?${qs.toString()}`
      );
      setPreview(body);
    } catch (e) {
      setPreview(null);
      setPreviewError(previewErrorMessage(e, repo, pr));
    } finally {
      setPreviewLoading(false);
    }
  }, [repoInput, prInput]);

  // ---- Recent lands fetch (polled) ----
  const fetchLands = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (landsRepoFilter.trim()) qs.set("repo", landsRepoFilter.trim());
      qs.set("limit", "25");
      const body = await httpClient.get<LandsResponse>(
        `${API}/lands?${qs.toString()}`
      );
      setLands(body.lands ?? []);
      setLandsError(null);
      setLandsLoaded(true);
    } catch (e) {
      setLandsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLandsLoading(false);
    }
  }, [landsRepoFilter]);

  useEffect(() => {
    setLandsLoading(true);
    fetchLands();
    const id = setInterval(fetchLands, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchLands]);

  // Newest-first (coord may already sort; we guard here so the contract is
  // explicit and the list is stable regardless of coord ordering).
  const sortedLands = useMemo(() => {
    return [...lands].sort((a, b) =>
      (b.signature.created_at ?? "").localeCompare(
        a.signature.created_at ?? ""
      )
    );
  }, [lands]);

  const counts = useMemo(
    () => ({
      all: sortedLands.length,
      attention: sortedLands.filter(needsAHuman).length,
      unverified: sortedLands.filter(isUnverified).length,
    }),
    [sortedLands]
  );

  const shown = useMemo(() => {
    if (tab === "attention") return sortedLands.filter(needsAHuman);
    if (tab === "unverified") return sortedLands.filter(isUnverified);
    return sortedLands;
  }, [sortedLands, tab]);

  const health = useMemo(
    () => deriveLandsHealth(sortedLands, landsLoaded),
    [sortedLands, landsLoaded]
  );

  // The calibration summary that stays visible when section 3 is collapsed
  // (R7 — "secondary material collapses, but its signal does not"). Worst
  // precision across the dimensions coord SCORED; `null` rates are excluded
  // rather than treated as 0, which is `formatRate`'s whole contract.
  //
  // `precisionAt === null` means nothing has answered yet, which is UNKNOWN —
  // rendered as such, never as "no dimensions scored".
  const precisionSummary = useMemo(() => {
    if (precisionAt === null) return "not loaded yet";
    const dims = precision?.dimensions ?? [];
    if (dims.length === 0) return "no dimensions scored";
    const scored = dims.filter(
      (d) => typeof d.precision === "number" && !Number.isNaN(d.precision)
    );
    if (scored.length === 0) return `${dims.length} dimensions, no data yet`;
    const worst = scored.reduce((a, b) =>
      (a.precision as number) <= (b.precision as number) ? a : b
    );
    return `worst ${worst.dimension} ${formatRate(worst.precision)}`;
  }, [precision, precisionAt]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-lands-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-lands-health"
      />

      {/* ---- 1. Preview panel (R7) ---- */}
      <CollapsiblePanel
        title="Pre-land impact preview"
        icon={<Anchor className="h-4 w-4" />}
        // Open by default; see the module doc for why (a frozen Spec-CI
        // criterion sits inside, and CollapsiblePanel unmounts when closed).
        defaultOpen
        storageKey="coord-lands-preview"
        summary={
          <Badge
            variant="outline"
            className="text-[11px] normal-case tracking-normal"
            title="the preview is an explicit action — it fires no poll"
          >
            {preview ? "showing a prediction" : "on demand"}
          </Badge>
        }
        contentClassName="space-y-3"
        data-testid="coord-lands-preview-panel"
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runPreview();
          }}
          data-testid="coord-lands-preview-form"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground normal-case tracking-normal">
              Repo (owner/name)
            </label>
            <Input
              placeholder="qontinui/qontinui-coord"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              className="w-64"
              data-testid="coord-lands-preview-repo"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground normal-case tracking-normal">
              PR number
            </label>
            <Input
              placeholder="123"
              inputMode="numeric"
              value={prInput}
              onChange={(e) => setPrInput(e.target.value)}
              className="w-28"
              data-testid="coord-lands-preview-pr"
            />
          </div>
          <Button
            type="submit"
            disabled={previewLoading}
            data-testid="coord-lands-preview-btn"
          >
            <Search className="h-3.5 w-3.5 mr-1" />
            {previewLoading ? "Predicting…" : "Preview"}
          </Button>
        </form>

        {previewError && (
          <p
            className="text-sm text-destructive normal-case tracking-normal"
            data-testid="coord-lands-preview-error"
          >
            {previewError}
          </p>
        )}

        {previewLoading && !preview ? (
          <Skeleton className="h-40 w-full" />
        ) : preview ? (
          <LandPreviewPanel preview={preview} />
        ) : (
          !previewError && (
            <p className="text-sm text-muted-foreground italic normal-case tracking-normal">
              Enter a repo and PR number to predict the land&apos;s impact
              before approving it.
            </p>
          )
        )}
      </CollapsiblePanel>

      {/* ---- 2. Recent lands ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterTabs<TabId>
          tabs={[
            // `null` until the first answer commits — `–`, never `0` (R6).
            { id: "all", label: "All", count: landsLoaded ? counts.all : null },
            {
              id: "attention",
              label: "Needs a human",
              count: landsLoaded ? counts.attention : null,
              attention: counts.attention > 0,
            },
            {
              id: "unverified",
              label: "Unverified",
              count: landsLoaded ? counts.unverified : null,
            },
          ]}
          active={tab}
          onChange={setTab}
          testIdPrefix="coord-lands-tab"
        />
        <Input
          placeholder="Filter by repo (owner/name)"
          value={landsRepoFilter}
          onChange={(e) => setLandsRepoFilter(e.target.value)}
          className="w-64 ml-auto"
          data-testid="coord-lands-repo-filter"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLands}
          data-testid="coord-lands-refresh"
          aria-label="Refresh recent lands"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {landsError && (
        <p className="text-sm text-destructive">Failed to load: {landsError}</p>
      )}

      <RecordList
        items={shown}
        itemKey={(row) => row.signature.id}
        loaded={!(landsLoading && lands.length === 0)}
        skeletonRows={6}
        renderRow={(row, ctx) => (
          <LandRow row={row} expanded={ctx.expanded} onToggle={ctx.onToggle} />
        )}
        empty={
          <p className="text-sm text-muted-foreground italic">
            {tab !== "all" ? (
              <>
                No declared lands in this window{" "}
                {tab === "attention" ? "need a human" : "are unverified"}.
              </>
            ) : (
              <>
                No declared lands
                {landsRepoFilter.trim()
                  ? ` for ${landsRepoFilter.trim()}`
                  : ""}{" "}
                yet.
              </>
            )}
          </p>
        }
      />

      {/* ---- 3. Calibration (R7 — the poll this page used to charge every
              visitor for; collapsing it unmounts the table AND stops it) ---- */}
      <CollapsiblePanel
        title="Predictor calibration (per dimension)"
        icon={<Gauge className="h-4 w-4" />}
        defaultOpen
        storageKey="coord-lands-precision"
        summary={
          <Badge
            variant="outline"
            className="text-[11px] normal-case tracking-normal"
            title={
              precisionAt === null
                ? "the calibration poll runs only while this panel is open — nothing has answered yet"
                : `worst per-dimension precision coord has scored, as of ${precisionAt}. Dimensions with no data are excluded, never counted as 0%. Not refreshed while this panel is collapsed.`
            }
          >
            {precisionSummary}
          </Badge>
        }
        className="p-4"
        contentClassName="mt-3"
        data-testid="coord-lands-precision-panel"
      >
        <LandPrecisionSection
          data={precision}
          error={precisionError}
          loadedAt={precisionAt}
          onData={handlePrecision}
        />
      </CollapsiblePanel>
    </div>
  );
}
