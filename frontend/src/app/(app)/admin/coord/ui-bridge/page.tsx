"use client";

/**
 * /admin/coord/ui-bridge — the UI Bridge dashboard: how agents see and
 * operate a running application, for the runner this tree targets.
 *
 * Plan `2026-10-23-console-presentation-spaces` Phase 6 (web half), and lens
 * surface 4 of 5 (`LENS_SURFACES`). Six panels, in this order:
 *
 * | panel | source |
 * |---|---|
 * | Registered applications | web `GET /api/v1/fleet/apps` + the runner's `GET /apps` |
 * | Screens and states | the runner's `apps/{id}/spec/list` and `/spec/graph` |
 * | Live element snapshot | the runner's `ui-bridge/control/snapshot`, on demand |
 * | Capabilities and trust | the runner's `/health` (`sdkFeatures`, `uiBridgeBinding`, build) |
 * | Controls and what they do | the runner's `ui-bridge/control/components` |
 * | Page health | the runner's `ui-bridge/control/page-health` + the occlusion sweep, on demand |
 *
 * Every runner read goes over the cloud relay by device id
 * (`_lib/relayReads.ts`, and the digital twin's `useUiBridge` hooks, reused).
 *
 * ## What this page will not say
 *
 * - **An empty panel for a read that did not answer.** A runner whose build
 *   predates the relay entries this page reads answers 403; that panel reads
 *   UNKNOWN and names the build (`relaySource.ts`). An unreachable runner, a
 *   refused route and a withheld answer each name their own reason.
 * - **"Read" for an action nobody classified.** An action with no declared
 *   effect is UNDECLARED, counted and badged as such (`componentEffectStatus.ts`).
 * - **"Clear" for a sweep that observed nothing.** `clear` without
 *   `occlusionDataObserved: true` is UNKNOWN (`occlusionStatus.ts`).
 * - **0 for a number it could not read.** A missing count is `–`.
 *
 * Presentation mode (plan D1–D3) changes only the rendering: captions before
 * each panel, provenance beside every figure, every panel held open, the app
 * picker operator-only, machine names aliased, free text through
 * `RedactedText` (`_lib/firstParty.ts` says which text can be attributed),
 * and the window's own text left out. There is no write control on the page:
 * the two buttons that are not panel toggles — capture a snapshot, run page
 * health — read, and say so.
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`, §3.9 for this
 * page): no page title (R9), strip first (R1), panels collapsible with their
 * signal kept in the summary (R7), one line per record whose detail expands
 * in place (R2, R5).
 */

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HealthStrip, RefreshButton } from "@/components/console";
import {
  Caption,
  MachineName,
  useMachineName,
} from "@/components/presentation";
import { useRunnerApps } from "@/app/(app)/digital-twin/_hooks/useUiBridge";
import { mergeAppRegistries } from "./_lib/appRegistryStatus";
import { countEffects, readComponents } from "./_lib/componentEffectStatus";
import { deriveDashboardHealth } from "./_lib/dashboardHealth";
import { readOcclusion } from "./_lib/occlusionStatus";
import { readPageHealth } from "./_lib/pageHealthStatus";
import { queryView, readStateOf, type ReadState } from "./_lib/readState";
import { RUNNER_ROUTES } from "./_lib/relayReads";
import { buildLabel, type BuildReading } from "./_lib/relaySource";
import { buildReadingOf, readRunnerPosture } from "./_lib/runnerHealth";
import {
  useDashboardRunner,
  useFleetAppsRead,
  usePageHealthRun,
  useRunnerComponentsRead,
  useRunnerHealthRead,
} from "./_lib/useUiBridgeDashboard";
import { AppRegistryPanel } from "./_components/AppRegistryPanel";
import { ComponentActionsPanel } from "./_components/ComponentActionsPanel";
import { LiveSnapshotPanel } from "./_components/LiveSnapshotPanel";
import { PageHealthPanel } from "./_components/PageHealthPanel";
import { SdkPosturePanel } from "./_components/SdkPosturePanel";
import { SpecGraphPanel } from "./_components/SpecGraphPanel";

const mapRead = <T, U>(read: ReadState<T>, f: (v: T) => U): ReadState<U> =>
  read.state === "ok" ? { ...read, value: f(read.value) } : read;

export default function UiBridgeDashboardPage() {
  const queryClient = useQueryClient();
  const { deviceId, identity, noRunner } = useDashboardRunner();
  const machine = useMachineName(identity);

  const healthQuery = useRunnerHealthRead(deviceId);
  const componentsQuery = useRunnerComponentsRead(deviceId);
  const fleetAppsQuery = useFleetAppsRead();
  const runnerAppsQuery = useRunnerApps(deviceId);
  const healthRun = usePageHealthRun(deviceId);

  const health = readStateOf(queryView(healthQuery), readRunnerPosture);
  const components = readStateOf(queryView(componentsQuery), readComponents);
  const web = readStateOf(queryView(fleetAppsQuery), (d) =>
    Array.isArray(d) ? d : null
  );
  const runnerApps = readStateOf(queryView(runnerAppsQuery), (d) =>
    Array.isArray(d.apps) ? d.apps : null
  );
  const pageHealth = readStateOf(
    queryView(healthRun.pageHealth),
    readPageHealth
  );
  const occlusion = readStateOf(queryView(healthRun.visibility), readOcclusion);

  const build: BuildReading = buildReadingOf(
    health.state === "ok" ? health.value : null,
    noRunner !== null
      ? "no runner is read"
      : health.state === "failed"
        ? "its health did not answer"
        : "its health has not answered yet"
  );

  const webApps = web.state === "ok" ? web.value : null;
  const runnerAppList = runnerApps.state === "ok" ? runnerApps.value : null;
  const appRows = useMemo(
    () => mergeAppRegistries(webApps, runnerAppList),
    [webApps, runnerAppList]
  );
  const appIds = useMemo(
    () => (appRows ?? []).map((row) => row.appId),
    [appRows]
  );

  const strip = deriveDashboardHealth({
    machine,
    noRunner,
    health,
    components: mapRead(components, (c) => countEffects(c.components)),
    pageHealth: mapRead(pageHealth, (p) => p.summary),
    occlusion: mapRead(occlusion, (o) => o.kind),
    apps: appRows?.length ?? null,
    sdkFeatures:
      health.state === "ok" ? (health.value.sdkFeatures?.length ?? null) : null,
    componentsRoute: RUNNER_ROUTES.components,
  });

  const refreshHealth = healthQuery.refetch;
  const refreshComponents = componentsQuery.refetch;
  const refreshWebApps = fleetAppsQuery.refetch;
  const refresh = () =>
    Promise.all([
      refreshHealth(),
      refreshComponents(),
      refreshWebApps(),
      // The twin's reads: the runner's app list and every app's spec reads.
      queryClient.refetchQueries({
        queryKey: ["digital-twin", "apps", deviceId],
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: ["digital-twin", "spec-list", deviceId],
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: ["digital-twin", "spec-graph", deviceId],
        type: "active",
      }),
    ]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-ui-bridge-page"
      data-ui-bridge-id="coord-ui-bridge-page"
    >
      <Caption id="ui-bridge.page" level={2} />
      <HealthStrip
        data-testid="coord-ui-bridge-health-strip"
        level={strip.level}
        headline={strip.headline}
        detail={noRunner === null ? buildLabel(build) : undefined}
        badges={strip.badges}
      />
      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={refresh}
          label="Refresh the UI Bridge dashboard"
          title="Re-reads the runner's health, components and screens and both app registries now. The live snapshot and page health run only from their own buttons."
          data-testid="coord-ui-bridge-refresh"
        />
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-runner"
        >
          {deviceId !== null ? (
            <>
              Reading <MachineName identity={identity} /> over the cloud relay.
            </>
          ) : (
            <>No runner is read: {noRunner}.</>
          )}
        </p>
      </div>

      <AppRegistryPanel
        web={web}
        webError={fleetAppsQuery.error}
        runner={runnerApps}
        build={build}
      />
      <SpecGraphPanel
        deviceId={deviceId}
        build={build}
        appIds={appIds}
        noRunner={noRunner}
      />
      <LiveSnapshotPanel deviceId={deviceId} build={build} noRunner={noRunner} />
      <SdkPosturePanel health={health} build={build} noRunner={noRunner} />
      <ComponentActionsPanel
        components={components}
        build={build}
        noRunner={noRunner}
      />
      <PageHealthPanel
        pageHealth={pageHealth}
        occlusion={occlusion}
        run={healthRun.run}
        running={
          healthRun.pageHealth.isFetching || healthRun.visibility.isFetching
        }
        canRun={deviceId !== null}
        build={build}
        noRunner={noRunner}
      />
    </div>
  );
}
