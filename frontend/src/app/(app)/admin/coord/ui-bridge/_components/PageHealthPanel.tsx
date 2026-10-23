"use client";

/**
 * Panel 6 — page health and occlusion, run together and ON DEMAND (each
 * drives a full `discover` of the runner's window): page health from
 * `POST /ui-bridge/control/page-health` (`pageHealthStatus.ts`) and the occlusion
 * verdict from the sweep (`occlusionStatus.ts`), shown as two separate answers —
 * page health carries no occlusion verdict, so a healthy page never stands in
 * for "nothing is covered".
 *
 * The occlusion row is HONEST: a "clear" sweep that observed no occlusion
 * data is UNKNOWN, never clear (served policy `ux-priorities`
 * `the-runner-serves-the-occlusion-sweep-and-it-is-currently-vacuous`), and a
 * runner whose relay does not carry the sweep says so with its build.
 *
 * The run button is navigation-only: it reads, and changes nothing on the
 * runner. The text the text-signal check quoted from the window, and the
 * runner's engineering detail lines, are the operator's only.
 */

import { Loader2, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCluster, StatusBadge } from "@/components/console";
import {
  NAVIGATION_ONLY_PROPS,
  Provenance,
  usePresentationMode,
} from "@/components/presentation";
import {
  OCCLUSION_ATTENTION_BY_KIND,
  OCCLUSION_LABEL,
  OCCLUSION_PALETTE,
  occlusionSummary,
  type OcclusionReading,
} from "../_lib/occlusionStatus";
import {
  PAGE_HEALTH_ATTENTION_BY_KIND,
  PAGE_HEALTH_LABEL,
  PAGE_HEALTH_PALETTE,
  type PageHealthFinding,
  type PageHealthKind,
  type PageHealthReading,
} from "../_lib/pageHealthStatus";
import type { ReadState } from "../_lib/readState";
import { RUNNER_ROUTES } from "../_lib/relayReads";
import { sourceIssueText, type BuildReading } from "../_lib/relaySource";
import { DashboardPanel } from "./DashboardPanel";
import { RunnerReadUnknown, SourceUnknown, StaleReadNote } from "./SourceUnknown";

export interface PageHealthPanelProps {
  pageHealth: ReadState<PageHealthReading>;
  occlusion: ReadState<OcclusionReading>;
  /** Start (or re-run) both reads. */
  run: () => Promise<unknown> | void;
  running: boolean;
  canRun: boolean;
  build: BuildReading;
  noRunner: string | null;
}

function HealthBadge({ kind, reason }: { kind: PageHealthKind; reason?: string }) {
  return (
    <StatusBadge
      status={{
        kind,
        label: PAGE_HEALTH_LABEL[kind],
        reason,
        attention: PAGE_HEALTH_ATTENTION_BY_KIND[kind],
      }}
      palette={PAGE_HEALTH_PALETTE}
    />
  );
}

function FindingLine({
  finding,
  presenting,
}: {
  finding: PageHealthFinding;
  presenting: boolean;
}) {
  const quotes = finding.quoted
    ? [...finding.quoted.errors, ...finding.quoted.loading, ...finding.quoted.empty]
    : [];
  return (
    <li
      className="space-y-1"
      data-testid="coord-ui-bridge-health-finding"
      data-check={finding.check ?? undefined}
      data-severity={finding.kind}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <HealthBadge kind={finding.kind} />
        <span className="text-sm font-medium">{finding.label}</span>
        <span className="text-xs text-muted-foreground">
          {finding.summary ??
            (presenting ? "No readable figures." : finding.runnerDetail ?? "No readable figures.")}
        </span>
      </div>
      {!presenting && quotes.length > 0 && (
        <ul
          className="m-0 list-none space-y-0.5 pl-4 text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-health-quotes"
        >
          {quotes.map((q, i) => (
            <li key={i} className="truncate" title={q}>
              “{q}”
            </li>
          ))}
        </ul>
      )}
      {!presenting && finding.runnerDetail && finding.summary && (
        <p className="m-0 pl-4 font-mono text-[10px] text-muted-foreground/60 break-all">
          {finding.check ?? "check"}: {finding.runnerDetail}
        </p>
      )}
    </li>
  );
}

/** The 20×20 occupancy grid: a filled cell holds at least one visible element. */
function Heatmap({ rows }: { rows: readonly string[] }) {
  const width = Math.max(...rows.map((r) => r.length));
  return (
    <div
      className="inline-grid gap-px rounded-sm border border-border bg-border p-px"
      style={{ gridTemplateColumns: `repeat(${width}, 0.5rem)` }}
      role="img"
      aria-label={`Where elements sit on the screen: ${rows.join("").split("").filter((c) => c === "#").length} of ${rows.length * width} cells hold an element`}
      data-testid="coord-ui-bridge-health-heatmap"
    >
      {rows.flatMap((row, y) =>
        [...row.padEnd(width, ".")].map((cell, x) => (
          <span
            key={`${y}-${x}`}
            className={cell === "#" ? "h-2 w-2 bg-foreground/50" : "h-2 w-2 bg-card"}
          />
        ))
      )}
    </div>
  );
}

function OcclusionRow({ reading }: { reading: OcclusionReading }) {
  return (
    <div
      className="space-y-1"
      data-testid="coord-ui-bridge-occlusion"
      data-occlusion={reading.kind}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <StatusBadge
          status={{
            kind: reading.kind,
            label: OCCLUSION_LABEL[reading.kind],
            reason: reading.unknownReason ?? undefined,
            attention: OCCLUSION_ATTENTION_BY_KIND[reading.kind],
          }}
          palette={OCCLUSION_PALETTE}
        />
        <span className="text-sm font-medium">Occlusion</span>
        <span className="text-xs text-muted-foreground">
          {occlusionSummary(reading)}
        </span>
      </div>
      {reading.kind !== "unknown" && reading.overlaysClassified === false && (
        <p className="m-0 pl-4 text-xs text-muted-foreground">
          The runner had no modal stack to consult, so a dialog over the page
          counts as an occlusion here.
        </p>
      )}
    </div>
  );
}

export function PageHealthPanel({
  pageHealth,
  occlusion,
  run,
  running,
  canRun,
  build,
  noRunner,
}: PageHealthPanelProps) {
  const { presenting } = usePresentationMode();
  const report = pageHealth.state === "ok" ? pageHealth.value : null;
  const asked = pageHealth.state !== "idle" || occlusion.state !== "idle";

  return (
    <DashboardPanel
      captionId="ui-bridge.page-health"
      icon={<Stethoscope className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        report ? (
          <HealthBadge kind={report.summary} />
        ) : (
          <span
            className="text-xs text-muted-foreground"
            data-testid="coord-ui-bridge-health-summary"
          >
            not run
          </span>
        )
      }
      headerActions={
        <Button
          {...NAVIGATION_ONLY_PROPS}
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={!canRun || running}
          onClick={() => {
            void run();
          }}
          title="Check the runner's current screen now. Reads only: nothing on the runner changes."
          data-testid="coord-ui-bridge-health-run"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
          )}
          {asked ? "Run again" : "Run page health"}
        </Button>
      }
      data-testid="coord-ui-bridge-health"
    >
      {noRunner !== null ? (
        <SourceUnknown
          text={sourceIssueText(
            { kind: "no-runner", reason: noRunner },
            RUNNER_ROUTES.pageHealth,
            build
          )}
          data-testid="coord-ui-bridge-health-unknown"
        />
      ) : !asked ? (
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="coord-ui-bridge-health-idle"
        >
          Not run yet — page health and the occlusion sweep read the runner&apos;s
          live window, so they run only when asked.
        </p>
      ) : (
        <>
          <section className="space-y-2" data-testid="coord-ui-bridge-health-report">
            {pageHealth.state === "loading" ? (
              <p className="m-0 text-sm text-muted-foreground">Checking…</p>
            ) : pageHealth.state === "failed" ? (
              <RunnerReadUnknown
                issue={pageHealth.issue}
                route={RUNNER_ROUTES.pageHealth}
                build={build}
                data-testid="coord-ui-bridge-health-unknown"
              />
            ) : report ? (
              <>
                {pageHealth.state === "ok" && pageHealth.stale && (
                  <StaleReadNote
                    asOf={pageHealth.asOf}
                    data-testid="coord-ui-bridge-health-stale"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <HealthBadge kind={report.summary} />
                  <StatCluster
                    data-testid="coord-ui-bridge-health-counts"
                    stats={[
                      {
                        key: "elements",
                        label: "elements ",
                        value: report.elementCount,
                      },
                      {
                        key: "visible",
                        label: "visible ",
                        value: report.visibleCount,
                      },
                    ]}
                  />
                  <Provenance
                    source="the runner's page health"
                    asOf={pageHealth.state === "ok" ? pageHealth.asOf : null}
                  />
                </div>
                <div className="flex flex-wrap items-start gap-4">
                  <ul className="m-0 min-w-0 flex-1 list-none space-y-2 p-0">
                    {report.findings.map((f) => (
                      <FindingLine key={f.key} finding={f} presenting={presenting} />
                    ))}
                  </ul>
                  {report.heatmap && <Heatmap rows={report.heatmap} />}
                </div>
              </>
            ) : null}
          </section>

          <section className="space-y-2" data-testid="coord-ui-bridge-occlusion-section">
            {occlusion.state === "loading" ? (
              <p className="m-0 text-sm text-muted-foreground">
                Sweeping for occlusion…
              </p>
            ) : occlusion.state === "failed" ? (
              <RunnerReadUnknown
                issue={occlusion.issue}
                route={RUNNER_ROUTES.visibility}
                build={build}
                data-testid="coord-ui-bridge-occlusion-unknown"
              />
            ) : occlusion.state === "ok" ? (
              <>
                {occlusion.stale && (
                  <StaleReadNote
                    asOf={occlusion.asOf}
                    data-testid="coord-ui-bridge-occlusion-stale"
                  />
                )}
                <OcclusionRow reading={occlusion.value} />
                <Provenance
                  source="the runner's occlusion sweep"
                  asOf={occlusion.asOf}
                />
              </>
            ) : null}
          </section>
        </>
      )}
    </DashboardPanel>
  );
}
