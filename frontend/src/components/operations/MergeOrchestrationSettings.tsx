"use client";

/**
 * Merge Orchestrator → Settings — per-tenant calibration knobs.
 *
 * Phase 2 D2.4 of the PR Merge Orchestrator
 * (`D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md`).
 *
 * Sibling of {@link MergePipeline}. Renders two sections:
 *
 * 1. **Tenant defaults** — the row in `coord.tenant_merge_settings`.
 *    Inline edits PATCH `/api/v1/operations/pr-merge/settings`.
 * 2. **Per-repo overrides** — one card per repo in
 *    `coord.tenant_repos`, with NULL=inherit display + edit per field.
 *    Inline edits PATCH `/api/v1/operations/pr-merge/repos/:repo/profile`.
 *
 * Merge enablement is a BOOLEAN (`merge_enabled`), not the retired
 * `rollout_state` tri-state, and it is written through the audited
 * `POST /pr-merge/merge-enabled` route rather than either PATCH. Every
 * control that renders it also renders whether the value is PINNED at that
 * scope or inherited — coord serves `merge_enabled_override` (the raw pin)
 * beside the resolved boolean precisely so this page can stop guessing.
 *
 * This page is a **calibration** surface, secondary to the Phase 8 onboarding
 * flow — most users shouldn't have a reason to visit. The emergency stop is
 * not here; it lives on the fleet page's merge-train view, which is the
 * surface an operator is actually on during an incident.
 *
 * This module is the composer only: it owns the page's three reads and the
 * section order. Each card lives in `./merge-settings/`, beside the form-field
 * shape (`types.ts`), the parse/format helpers (`format.ts`) and the
 * pinned-vs-inherited helpers (`pinChoice.tsx`). The routes and their wire
 * types are the typed client's, `@/lib/api/operations/prMerge`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { createLogger } from "@/lib/logger";
import {
  fetchMergeSlo,
  fetchTenantRepos,
  fetchTenantSettings,
  type EffectiveProfile,
  type SloResponse,
  type TenantRepoRow,
} from "@/lib/api/operations/prMerge";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { TenantDefaultsCard } from "./merge-settings/TenantDefaultsCard";
import { RepoOverrideCard } from "./merge-settings/RepoOverrideCard";
import { SloDashboardCard } from "./merge-settings/SloDashboardCard";
import { ffLandHeadSyncSupported } from "./merge-settings/format";

const log = createLogger("MergeOrchestrationSettings");

// ----------------------------------------------------------------------------
// Top-level component
// ----------------------------------------------------------------------------

export function MergeOrchestrationSettings() {
  const [profile, setProfile] = useState<EffectiveProfile | null>(null);
  const [repos, setRepos] = useState<TenantRepoRow[] | null>(null);
  const [slo, setSlo] = useState<SloResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // All three reads are settled before any is judged, so the page words a
    // refusal exactly as it did when it checked raw responses in order:
    // `settings: HTTP <status>`, then `repos: HTTP <status>`. A rejection
    // that is not a status (network, unparseable body) is its own message.
    const settle = <T,>(read: Promise<T>) =>
      read.then(
        (body) => ({ ok: true as const, body }),
        (err: unknown) => ({ ok: false as const, err })
      );
    const refusal = (label: string, err: unknown): unknown => {
      const status = httpStatusOf(err);
      return status === null ? err : new Error(`${label}: HTTP ${status}`);
    };
    Promise.all([
      settle(fetchTenantSettings()),
      settle(fetchTenantRepos()),
      settle(fetchMergeSlo()),
    ])
      .then(([s, r, sl]) => {
        if (!s.ok) throw refusal("settings", s.err);
        if (!r.ok) throw refusal("repos", r.err);
        if (cancelled) return;
        setProfile(s.body.profile);
        setRepos(r.body.repos);
        setError(null);
        if (sl.ok) {
          setSlo(sl.body);
        } else if (httpStatusOf(sl.err) !== null) {
          // SLO is best-effort — a refusal (e.g. coord down) shouldn't
          // block the rest of the page from rendering. Log but don't
          // propagate to top-level error banner — the SLO card surfaces its
          // own loading state.
          log.warn("slo fetch failed", httpBodyOf(sl.err) ?? "?");
        } else {
          throw sl.err;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadCounter]);

  const triggerReload = useCallback(() => {
    setReloadCounter((c) => c + 1);
  }, []);

  const subtitle = useMemo(
    () =>
      "Settings are managed automatically by the Repo Audit + Drift loop. Manual edits are saved with profile_source='user_edit' and are preserved when the audit re-runs.",
    []
  );

  // Is the tenant-wide pause latched?
  //
  // coord has no tenant-tier `merge_enabled` column, and the per-repo default
  // is `true`, so the TENANT profile (repo="") can only resolve false when
  // `tenant_merge_settings.merge_paused` is set. That makes this a sound
  // reading of the latch rather than a guess — and it is the only signal for
  // it the dashboard gets. `null` profile is UNKNOWN, not "not paused": the
  // banner stays silent rather than asserting the fleet is running.
  const tenantPaused = profile !== null && !profile.merge_enabled;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SettingsIcon className="h-5 w-5" />
            Merge Orchestrator → Settings
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        </CardHeader>
      </Card>
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-red-300 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}
      {/* The tenant pause, stated ONCE and above everything.

          Without this the latch has no indicator anywhere: an operator who
          has just stopped the fleet opens this page, sees per-repo switches
          still reading ON (they show the PIN, which the pause outranks), and
          concludes the stop did not take. Read-only and ungated — every
          member should be able to see that merging is off, even though only
          an admin can lift it. */}
      {tenantPaused && (
        <Card className="border-red-500/60" data-testid="tenant-paused-banner">
          <CardContent className="pt-4">
            <p className="text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>Merges are paused tenant-wide.</strong> Nothing lands on
                any repo this tenant owns, including repos pinned on — the pause
                overrides every per-repo setting below. Lift it with the
                &ldquo;Merges enabled tenant-wide&rdquo; switch in Tenant
                defaults.
              </span>
            </p>
          </CardContent>
        </Card>
      )}
      {/* The emergency stop does NOT live here. A destructive, tenant-wide
          red button at the top of a calibration page is the wrong blast
          radius in the wrong place: this page is where you tune dwell times,
          not where you go mid-incident. It now sits per-repo on the merge
          train's incident view (MergeTrainActivity), still CoordAdminOnly.
          The tenant pause LATCH is still reachable from Tenant defaults below
          — it is a settings-shaped control with an incident-shaped blast
          radius, so it carries the same confirm + typed-reason discipline. */}
      {/* Phase 9 D9.6 — SLO Dashboard. Read-only metrics render for all
          members; the embedded merge-enabled control is itself gated. */}
      <SloDashboardCard
        data={slo}
        tenantPaused={tenantPaused}
        onChanged={triggerReload}
      />
      {/* Tenant defaults + per-repo overrides are tenant-config writes —
          admin only. */}
      <CoordAdminOnly>
        {profile === null ? (
          <Card>
            <CardContent className="pt-4">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ) : (
          <TenantDefaultsCard profile={profile} onSaved={triggerReload} />
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Per-repo overrides</span>
              {repos !== null && (
                <Badge variant="outline" className="font-mono text-xs">
                  {repos.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {repos === null ? (
              <Skeleton className="h-24 w-full" />
            ) : repos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No repos registered. Repos auto-register on first PATCH of their
                per-repo override.
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {repos.map((r) => (
                  <RepoOverrideCard
                    key={r.repo}
                    repoRow={r}
                    tenantPaused={tenantPaused}
                    // `profile` is null while the tenant read is in flight, and
                    // these cards render anyway (only the tenant card gets a
                    // skeleton). Unknown capability reads as NOT writable —
                    // fail-closed, since the cost of guessing wrong is a 400
                    // that takes the whole per-repo save with it.
                    ffLandHeadSyncWritable={ffLandHeadSyncSupported(profile)}
                    onSaved={triggerReload}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </CoordAdminOnly>
    </div>
  );
}
