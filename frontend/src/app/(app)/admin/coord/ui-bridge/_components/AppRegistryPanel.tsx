"use client";

/**
 * Panel 1 — the app registry: every application the fleet can drive, from the
 * web's registry (`GET /api/v1/fleet/apps`) and this runner's own app list,
 * one row per app id (`appRegistryStatus.ts` merges them; presence needs BOTH
 * answers, so an unread side makes it UNKNOWN rather than "web only").
 *
 * Presentation mode (D3.3): an app's name is shown only for the runner's own
 * app, whose repository the tenant's first-party list can clear; every other
 * name renders as its descriptor, and the local checkout path and URL in the
 * detail are operator-only.
 */

import { useMemo, useState } from "react";
import { AppWindow } from "lucide-react";
import {
  BackendErrorMessage,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatCluster,
  StatusBadge,
} from "@/components/console";
import {
  OperatorOnly,
  Provenance,
  RedactedText,
  usePresentationMode,
} from "@/components/presentation";
import { operationsErrorReading } from "@/lib/api/operations/base";
import type { RegisteredApp } from "@/app/(app)/digital-twin/_lib/ui-bridge-types";
import {
  APP_PRESENCE_ATTENTION_BY_KIND,
  APP_PRESENCE_LABEL,
  APP_PRESENCE_PALETTE,
  appTotalMeaning,
  appTotalOf,
  appTotalValue,
  mergeAppRegistries,
  presenceCounts,
  updateStrategyLabel,
  type AppRow,
  type WebAppConfig,
} from "../_lib/appRegistryStatus";
import { appRepoOf } from "../_lib/firstParty";
import type { ReadState } from "../_lib/readState";
import { RUNNER_ROUTES } from "../_lib/relayReads";
import type { BuildReading } from "../_lib/relaySource";
import { DashboardPanel } from "./DashboardPanel";
import {
  RunnerReadUnknown,
  SourceUnknown,
  StaleReadNote,
} from "./SourceUnknown";

export interface AppRegistryPanelProps {
  web: ReadState<readonly WebAppConfig[]>;
  /** The web read's error, for its structured refusal. */
  webError: unknown;
  runner: ReadState<readonly RegisteredApp[]>;
  build: BuildReading;
}

const value = <T,>(read: ReadState<T>): T | null =>
  read.state === "ok" ? read.value : null;

const isoOf = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

/** Why a row's presence is what it is, in words (the detail's first line). */
function presenceWhy(row: AppRow): string {
  switch (row.presence) {
    case "both":
      return "Recorded in the web registry and on this runner.";
    case "web-only":
      return "Recorded in the web registry; this runner has no row for it.";
    case "runner-only":
      return "Recorded on this runner only — a runner on its own database keeps its own rows, so the web registry need not have it.";
    case "unknown":
      return row.inWeb === null
        ? "Whether the web registry has it is UNKNOWN: the web registry was not read."
        : "Whether this runner has it is UNKNOWN: this runner's app list was not read.";
  }
}

export function AppRegistryPanel({
  web,
  webError,
  runner,
  build,
}: AppRegistryPanelProps) {
  const { presenting } = usePresentationMode();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const webApps = value(web);
  const runnerApps = value(runner);
  const rows = useMemo(
    () => mergeAppRegistries(webApps, runnerApps),
    [webApps, runnerApps]
  );
  const counts = rows ? presenceCounts(rows) : null;
  const total = appTotalOf(rows, {
    web: webApps !== null,
    runner: runnerApps !== null,
  });
  const webAsOf = web.state === "ok" ? web.asOf : null;
  const runnerAsOf = runner.state === "ok" ? runner.asOf : null;

  return (
    <DashboardPanel
      captionId="ui-bridge.apps"
      icon={<AppWindow className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-apps-summary"
          title={appTotalMeaning(total)}
        >
          {appTotalValue(total) ?? "–"} apps
        </span>
      }
      data-testid="coord-ui-bridge-apps"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatCluster
          data-testid="coord-ui-bridge-apps-counts"
          stats={[
            {
              key: "apps",
              label: "apps ",
              value: appTotalValue(total),
              title: appTotalMeaning(total),
              "data-testid": "coord-ui-bridge-apps-total",
            },
            {
              key: "web",
              label: "in the web registry ",
              value: webApps?.length,
            },
            {
              key: "runner",
              label: "on this runner ",
              value: runnerApps?.length,
            },
            {
              key: "unknown",
              label: "presence UNKNOWN ",
              value: counts?.unknown,
              tone: counts !== null && counts.unknown > 0 ? "warning" : "muted",
            },
          ]}
        />
        <Provenance source="web app registry" asOf={webAsOf} />
        <Provenance source="this runner's app list" asOf={runnerAsOf} />
      </div>

      {web.state === "failed" && (
        <div
          className="space-y-1"
          data-testid="coord-ui-bridge-apps-web-unknown"
        >
          <SourceUnknown text="The web's app registry could not be read." />
          {/* The backend's own refusal: its detail can echo request input,
              and it can carry a copy-command button — the operator's
              diagnosis, not the audience's. */}
          <OperatorOnly>
            <BackendErrorMessage
              error={operationsErrorReading(webError)}
              className="block text-xs text-muted-foreground"
            />
          </OperatorOnly>
        </div>
      )}
      {web.state === "ok" && web.stale && (
        <StaleReadNote
          asOf={web.asOf}
          data-testid="coord-ui-bridge-apps-web-stale"
        />
      )}
      {runner.state === "failed" && (
        <RunnerReadUnknown
          issue={runner.issue}
          route={RUNNER_ROUTES.apps}
          build={build}
          data-testid="coord-ui-bridge-apps-runner-unknown"
        />
      )}

      <RecordList
        items={rows ?? []}
        itemKey={(row) => row.appId}
        loaded={
          rows !== null ||
          (web.state === "failed" && runner.state !== "loading")
        }
        expandedKey={expandedKey}
        onExpandedKeyChange={setExpandedKey}
        empty={
          rows === null ? (
            <p
              className="m-0 text-sm text-muted-foreground italic"
              data-testid="coord-ui-bridge-apps-none-read"
            >
              Neither registry answered, so which apps exist is unknown — not
              none.
            </p>
          ) : (
            <p
              className="m-0 text-sm text-muted-foreground"
              data-testid="coord-ui-bridge-apps-empty"
            >
              No app is registered in the registries that answered.
            </p>
          )
        }
        renderRow={(row, ctx) => (
          <RecordRow
            identity={presenting ? "app" : row.appId}
            label={
              <RedactedText
                text={row.displayName ?? row.appId}
                repo={appRepoOf(row.appId)}
                descriptor={{
                  kind: "App",
                  status: APP_PRESENCE_LABEL[row.presence],
                  at: isoOf(row.lastSeenAtMs),
                }}
              />
            }
            status={
              <StatusBadge
                status={{
                  kind: row.presence,
                  label: APP_PRESENCE_LABEL[row.presence],
                  reason: presenceWhy(row),
                  attention: APP_PRESENCE_ATTENTION_BY_KIND[row.presence],
                }}
                palette={APP_PRESENCE_PALETTE}
              />
            }
            reason={updateStrategyLabel(row.updateStrategy)}
            attention={APP_PRESENCE_ATTENTION_BY_KIND[row.presence]}
            time={
              <RowTime
                at={isoOf(row.lastSeenAtMs)}
                verb="Last seen by this runner"
                absent={{
                  label: "–",
                  title:
                    row.onRunner === null
                      ? "This runner's app list was not read"
                      : "This runner has not seen it",
                }}
              />
            }
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            data-testid="coord-ui-bridge-app-row"
          >
            <RecordDetail
              why={<p className="m-0">{presenceWhy(row)}</p>}
              history={
                <p className="m-0 text-xs text-muted-foreground">
                  Update strategy: {updateStrategyLabel(row.updateStrategy)}.
                </p>
              }
              raw={
                presenting ? undefined : (
                  <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
                    app {row.appId}
                    {row.repoRoot ? ` · checkout ${row.repoRoot}` : ""}
                    {row.uiBridgeUrl ? ` · UI Bridge ${row.uiBridgeUrl}` : ""}
                  </p>
                )
              }
            />
          </RecordRow>
        )}
      />
    </DashboardPanel>
  );
}
