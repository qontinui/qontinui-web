"use client";

/**
 * /admin/coord/deploys — Deploy effect-signatures operator dashboard.
 *
 * Plan `2026-05-31-deploy-action-effect-signatures` — the operator read
 * surface over coord's deploy verifier: every CI deploy declares a
 * DeploySignature (deploy-coord.yml / deploy-web.yml §3.6 wiring) and gets
 * verified across the six dimensions (release/infra/schema/health/ci/config).
 * This page lists recent deploys newest-first with the composed D3 verdict,
 * the per-dimension row, coverage, and — for a settled hard terminal — the
 * on-demand rollback proposal.
 *
 * Coord base URL + operator auth are reused exactly as the lands sibling:
 * `httpClient.get` hits the web backend at `/api/v1/operations/deploys*`,
 * which forwards the operator's Cognito bearer to coord (the deploy read
 * routes are FleetPrincipal-gated — the forwarded bearer is the credential).
 * The frontend never talks to coord directly.
 *
 * The list auto-refreshes on a 30s poll (deploys legitimately sit `partial`
 * for minutes while the Ci/Config dimensions settle — the poll shows them
 * settle without a manual refresh).
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Recent declared
 *   deploys` wrapper is gone; its count moved into the health strip.
 * - **R1** — a `<HealthStrip>` derived from the rows ALREADY FETCHED opens the
 *   page. No second request.
 * - **R6** — `<FilterTabs>` over the verification verdict, with live counts.
 *   The service filter beside it stays an input because it is SERVER-side
 *   (coord's `service=` parameter); the verdict axis is client-side over the
 *   window already fetched, so all of its counts are real measurements.
 * - **R2/R5** — one deploy is one `<DeployRow>` line; detail expands in place.
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
import { httpClient } from "@/services/service-factory";
import { DeployRow } from "@/components/admin/coord/DeployRow";
import type { DeployRow as DeployRowData } from "@/components/admin/coord/deployTypes";
import {
  VERIFICATION_ATTENTION_BY_KIND,
  deriveVerificationStatus,
} from "@/components/admin/coord/verificationStatus";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

interface DeploysResponse {
  deploys?: DeployRowData[] | null;
}

type TabId = "all" | "attention" | "unsettled";

/** A deploy is "unsettled" while the verifier can still change its verdict. */
function isUnsettled(row: DeployRowData): boolean {
  return row.verification === null || row.verification.settled !== true;
}

function needsAHuman(row: DeployRowData): boolean {
  const kind = deriveVerificationStatus(row.verification).kind;
  return VERIFICATION_ATTENTION_BY_KIND[kind] === "author";
}

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch. `loaded=false` returns EARLY with badge labels that spell the dash
 * literally: `<HealthStrip>` renders `label` verbatim, so a null label renders
 * NOTHING rather than `–`.
 */
function deriveDeploysHealth(
  rows: DeployRowData[],
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
      detail: "counts appear once the deploy list arrives",
      badges: [
        { key: "total", label: <>deploys –</>, tone: "muted" },
        { key: "failed", label: <>failed –</>, tone: "muted" },
      ],
    };
  }

  let failed = 0;
  let unsettled = 0;
  let migrations = 0;
  for (const r of rows) {
    if (needsAHuman(r)) failed += 1;
    if (isUnsettled(r)) unsettled += 1;
    if (r.signature.migration_required) migrations += 1;
  }

  const level: HealthStripLevel =
    failed > 0 ? "red" : unsettled > 0 ? "amber" : "green";
  return {
    level,
    headline:
      failed > 0
        ? `${failed} deploy${failed === 1 ? "" : "s"} did not do what they declared`
        : rows.length === 0
          ? "No declared deploys in this window"
          : unsettled > 0
            ? `${unsettled} still settling; nothing failed`
            : "Every declared deploy verified clean",
    detail:
      rows.length === 0
        ? "deploys declare themselves from the CI pipelines on every rollout"
        : `${migrations} carried a schema migration`,
    badges: [
      { key: "total", label: <>deploys {rows.length}</>, tone: "muted" },
      {
        key: "failed",
        label: <>needs a human {failed}</>,
        tone: failed > 0 ? "attention" : "muted",
        title:
          "a failure or a contradiction — nothing downstream retries either one",
      },
      {
        key: "unsettled",
        label: <>settling {unsettled}</>,
        tone: "default",
        title: "the verifier is still observing dimensions on these",
      },
      { key: "migrations", label: <>migrations {migrations}</>, tone: "muted" },
    ],
  };
}

export default function CoordDeploysPage() {
  const [serviceFilter, setServiceFilter] = useState("");
  const [deploys, setDeploys] = useState<DeployRowData[]>([]);
  // TWO flags, because two different questions are being asked and one answer
  // cannot serve both (`/history` established this split):
  //   `loaded`  — has a read SUCCEEDED? Drives the counts, because R6 says an
  //               unfetched count renders `–` and never `0`.
  //   `settled` — has a read come BACK at all, success or failure? Drives the
  //               list, because skeletons after a failed read claim we are
  //               still loading, which is a second untrue thing on a row that
  //               already carries an error.
  const [loaded, setLoaded] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");

  const fetchDeploys = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (serviceFilter.trim()) qs.set("service", serviceFilter.trim());
      qs.set("limit", "25");
      const body = await httpClient.get<DeploysResponse>(
        `${API}/deploys?${qs.toString()}`
      );
      setDeploys(body.deploys ?? []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettled(true);
    }
  }, [serviceFilter]);

  useEffect(() => {
    fetchDeploys();
    const id = setInterval(fetchDeploys, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchDeploys]);

  // Newest-first (coord already sorts; guarded here so the contract is
  // explicit and stable regardless of coord ordering).
  const sorted = useMemo(() => {
    return [...deploys].sort((a, b) =>
      (b.signature.created_at ?? "").localeCompare(a.signature.created_at ?? "")
    );
  }, [deploys]);

  const counts = useMemo(
    () => ({
      all: sorted.length,
      attention: sorted.filter(needsAHuman).length,
      unsettled: sorted.filter(isUnsettled).length,
    }),
    [sorted]
  );

  const shown = useMemo(() => {
    if (tab === "attention") return sorted.filter(needsAHuman);
    if (tab === "unsettled") return sorted.filter(isUnsettled);
    return sorted;
  }, [sorted, tab]);

  const health = useMemo(
    () => deriveDeploysHealth(sorted, loaded),
    [sorted, loaded]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-deploys-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-deploys-health"
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
              id: "unsettled",
              label: "Still settling",
              count: loaded ? counts.unsettled : null,
            },
          ]}
          active={tab}
          onChange={setTab}
          testIdPrefix="coord-deploys-tab"
        />
        <Input
          placeholder="Filter by service (e.g. qontinui-coord)"
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="w-64 ml-auto"
          data-testid="coord-deploys-service-filter"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={fetchDeploys}
          data-testid="coord-deploys-refresh"
          aria-label="Refresh deploys"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <RecordList
        items={shown}
        itemKey={(r) => r.signature.id}
        loaded={settled || deploys.length > 0}
        skeletonRows={6}
        renderRow={(r, ctx) => (
          <DeployRow row={r} expanded={ctx.expanded} onToggle={ctx.onToggle} />
        )}
        empty={
          error ? null : (
          <p className="text-sm text-muted-foreground italic">
            {tab !== "all" ? (
              <>
                No declared deploys in this window{" "}
                {tab === "attention" ? "need a human" : "are still settling"}.
              </>
            ) : (
              <>
                No declared deploys
                {serviceFilter.trim() ? ` for ${serviceFilter.trim()}` : ""} yet.
                Deploys declare themselves from the CI pipelines
                (deploy-coord.yml / deploy-web.yml) on every rollout.
              </>
            )}
          </p>
          )
        }
      />
    </div>
  );
}
