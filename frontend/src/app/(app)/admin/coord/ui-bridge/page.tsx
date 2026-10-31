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
 * | Registered applications | web `GET /api/v1/fleet/apps` (staff only) + the runner's `GET /apps`; neither read while presenting |
 * | Screens and states | the runner's `apps/{id}/spec/list` and `/spec/graph` |
 * | Live element snapshot | the runner's `ui-bridge/control/snapshot`, on demand |
 * | Capabilities and trust | the runner's `/health` (`sdkFeatures`, `uiBridgeBinding`, build) |
 * | Controls and what they do | the runner's `ui-bridge/control/components` |
 * | Page health | the runner's `ui-bridge/control/page-health`, on demand; its occlusion row is UNKNOWN until a relay carries the visibility sweep |
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
 * - **"Clear" for an occlusion check nobody made.** The visibility sweep is
 *   the only source of an occlusion verdict and no relay carries it, so the
 *   occlusion row is UNKNOWN on every runner, whatever any runner answers —
 *   page health included (`occlusionStatus.ts`). Once a relay does carry it,
 *   `clear` still needs `occlusionDataObserved: true`.
 * - **0 for a number it could not read.** A missing count is `–`.
 * - **Another project's applications.** Neither app registry is partitioned
 *   by project, so while presenting neither is read, and each half reads
 *   UNKNOWN and says why (`appRegistryReadsOf`). The web registry answers
 *   only an active platform admin (anyone else gets a 403), and any
 *   signed-in member can open this URL, so in operator mode it is read only
 *   for staff; for every other viewer its half reads UNKNOWN and says why
 *   (`webRegistryAccessOf`) instead of showing the refusal.
 *
 * Presentation mode (plan D1–D3) changes the rendering — captions before
 * each panel, provenance beside every figure, every panel held open, the app
 * picker operator-only, machine names aliased, free text through
 * `RedactedText` (`_lib/firstParty.ts` says which text can be attributed),
 * and the window's own text left out — and fetches nothing new. The reads it
 * declines are the two app registries (D3.4, the bullet above); every other
 * read is the operator view's. There is no write control on the page:
 * the two buttons that are not panel toggles — capture a snapshot, run page
 * health — change no setting, session, file or app state. Each can make the
 * runner re-read its window's elements (page health always; the snapshot
 * when nothing is registered yet), which rebuilds the webview's in-memory
 * discovery cache from the live page, and each button's title says so.
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`, §3.10 for this
 * page): no page title (R9), strip first (R1), panels collapsible with their
 * signal kept in the summary (R7), one line per record whose detail expands
 * in place (R2, R5).
 */

import { useMemo } from "react";
import { HealthStrip, RefreshButton } from "@/components/console";
import {
  Caption,
  MachineName,
  Provenance,
  useMachineName,
  usePresentationMode,
} from "@/components/presentation";
import {
  appTotalOf,
  mergeAppRegistries,
  type RegistryRead,
} from "./_lib/appRegistryStatus";
import { countEffects, readComponents } from "./_lib/componentEffectStatus";
import { deriveDashboardHealth } from "./_lib/dashboardHealth";
import { readPageHealth } from "./_lib/pageHealthStatus";
import { queryView, readStateOf, type ReadState } from "./_lib/readState";
import { RUNNER_ROUTES, isRelayed } from "./_lib/relayReads";
import { buildLabel, type BuildReading } from "./_lib/relaySource";
import { buildReadingOf, readRunnerPosture } from "./_lib/runnerHealth";
import {
  appRegistryReadsOf,
  occlusionReadOf,
  refreshTitleOf,
  useDashboardRefresh,
  useDashboardRunner,
  useFleetAppsRead,
  usePageHealthRun,
  useRunnerAppListRead,
  useRunnerComponentsRead,
  useRunnerHealthRead,
  useWebRegistryAccess,
} from "./_lib/useUiBridgeDashboard";
import { AppRegistryPanel } from "./_components/AppRegistryPanel";
import { ComponentActionsPanel } from "./_components/ComponentActionsPanel";
import { LiveSnapshotPanel } from "./_components/LiveSnapshotPanel";
import { PageHealthPanel } from "./_components/PageHealthPanel";
import { SdkPosturePanel } from "./_components/SdkPosturePanel";
import { SpecGraphPanel } from "./_components/SpecGraphPanel";

const mapRead = <T, U>(read: ReadState<T>, f: (v: T) => U): ReadState<U> =>
  read.state === "ok" ? { ...read, value: f(read.value) } : read;

/** When a read's figures were read — null unless it answered. */
const asOfOf = (read: RegistryRead<unknown>): number | null =>
  read.state === "ok" ? read.asOf : null;

/**
 * Whether any relay carries the occlusion sweep — read from the route table,
 * not from anything a runner answers. False: the sweep is not asked for, and
 * the occlusion row is the standing UNKNOWN (`occlusionReadOf`).
 */
const SWEEP_RELAYED = isRelayed(RUNNER_ROUTES.visibility);

export default function UiBridgeDashboardPage() {
  const { presenting } = usePresentationMode();
  const { deviceId, identity, noRunner } = useDashboardRunner();
  const machine = useMachineName(identity);

  const healthQuery = useRunnerHealthRead(deviceId);
  const componentsQuery = useRunnerComponentsRead(deviceId);
  // Whether the web registry is read for this viewer: staff only, never while
  // presenting. The read's own hook asks the same question, so the two agree.
  const webAccess = useWebRegistryAccess();
  const fleetAppsQuery = useFleetAppsRead();
  const runnerAppsQuery = useRunnerAppListRead(deviceId);
  const healthRun = usePageHealthRun(deviceId, SWEEP_RELAYED);

  const health = readStateOf(queryView(healthQuery), readRunnerPosture);
  const components = readStateOf(queryView(componentsQuery), readComponents);
  const { web, runner: runnerApps } = appRegistryReadsOf({
    presenting,
    webAccess,
    web: queryView(fleetAppsQuery),
    runner: queryView(runnerAppsQuery),
  });
  const pageHealth = readStateOf(healthRun.pageHealthView, readPageHealth);
  const occlusion = occlusionReadOf({
    sweepRelayed: SWEEP_RELAYED,
    requested: healthRun.requested,
    sweep: healthRun.visibilityView,
  });

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
  const apps = appTotalOf(appRows, {
    web: webApps !== null,
    runner: runnerAppList !== null,
  });

  const strip = deriveDashboardHealth({
    machine,
    noRunner,
    health,
    components: mapRead(components, countEffects),
    pageHealth: mapRead(pageHealth, (p) => p.summary),
    occlusion: mapRead(occlusion, (o) => o.kind),
    apps,
    appsStale:
      (web.state === "ok" && web.stale) ||
      (runnerApps.state === "ok" && runnerApps.stale),
    sdkFeatures:
      health.state === "ok" ? (health.value.sdkFeatures?.length ?? null) : null,
    componentsRoute: RUNNER_ROUTES.components,
  });

  const refresh = useDashboardRefresh(deviceId);

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
          // What THIS press re-reads: chosen from the same answers the reads
          // are, so it never names a registry the page declines to read.
          title={refreshTitleOf({
            runner: deviceId !== null,
            presenting,
            webAccess,
          })}
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
        {/* Where the strip's figures come from, and when — presentation
            mode only (Provenance renders nothing for the operator). One chip
            per read behind a badge: the component counts, the SDK feature
            count and the build, and the app total's two registries. */}
        <span
          className="contents"
          data-testid="coord-ui-bridge-strip-provenance"
        >
          <Provenance
            source="the runner's component registry"
            asOf={asOfOf(components)}
          />
          <Provenance source="the runner's health" asOf={asOfOf(health)} />
          <Provenance source="web app registry" asOf={asOfOf(web)} />
          <Provenance
            source="this runner's app list"
            asOf={asOfOf(runnerApps)}
          />
        </span>
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
      <LiveSnapshotPanel
        deviceId={deviceId}
        build={build}
        noRunner={noRunner}
      />
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
