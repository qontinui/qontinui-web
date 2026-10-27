"use client";

/**
 * Panel 6 — page health, with the occlusion row beside it, run ON DEMAND (page
 * health drives a full `discover` of the runner's window): page health from
 * `POST /ui-bridge/control/page-health` (`pageHealthStatus.ts`) and the
 * occlusion row (`occlusionStatus.ts`), shown as two separate answers — page
 * health carries no occlusion verdict, so a healthy page never stands in for
 * "nothing is covered".
 *
 * The occlusion row is UNKNOWN on every runner today. Its only source is the
 * visibility sweep, no relay carries the sweep yet, and so the page does not
 * ask for it: the row says the sweep is not available over the relay, in plain
 * words and with its provenance (coord finding
 * `99796499-8e46-4d69-94ba-a2ac9fe3ea22`; plan
 * `2026-10-23-console-presentation-spaces` Phase 6, amendment 2026-10-24).
 * Page health's body is not consulted for it, so nothing page health returns
 * can make the row clear. Once a relay carries the sweep the row stays honest:
 * a "clear" that observed no occlusion data is UNKNOWN (served policy
 * `ux-priorities`
 * `the-runner-serves-the-occlusion-sweep-and-it-is-currently-vacuous`), and a
 * runner whose relay refuses the sweep says so with its build.
 *
 * The run button is navigation-only: it changes no setting, session, file or
 * app state. To answer, the runner re-reads its window's elements, which
 * rebuilds the webview's in-memory discovery cache — and the button's title
 * says so rather than "nothing changes". The text the text-signal check
 * quoted from the window, and the runner's engineering detail lines, are the
 * operator's only.
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
import {
  RunnerReadUnknown,
  SourceUnknown,
  StaleReadNote,
} from "./SourceUnknown";

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

/**
 * The run button's title: what pressing it does on the runner, exactly — no
 * setting, session, file or app state changes, but the runner re-reads its
 * window's elements to answer (qontinui-runner `relay_path_policy.rs`).
 */
export const PAGE_HEALTH_BUTTON_TITLE =
  "Check the runner's current screen now. It changes no setting, session, file or app state: the runner re-reads the elements in its window to answer.";

/**
 * The header badge's reason over a KEPT result: the latest run failed, so the
 * verdict shown is an earlier run's (R6: a kept verdict may not look
 * re-confirmed). It names no particular run, because React Query keeps the
 * last successful result through ANY number of failed re-runs
 * (`readState.ts`): after two, the run just before the latest failed too and
 * has no verdict, so "the run before it" would point at the wrong one. The
 * header is what stays in view while the panel is closed (R7), so it also
 * says so in words, beside the badge.
 */
export const PAGE_HEALTH_EARLIER_RUN_REASON =
  "The last run failed, so this is an earlier run's result — not a reading of the page as it is now.";

/**
 * The header badge's reason when page health has no reading: the run failed,
 * or the runner answered in a shape this page cannot read. Neutral on which,
 * because the panel's body says which.
 */
export const PAGE_HEALTH_NO_READING_REASON =
  "Page health has no reading; the panel says why.";

/**
 * Where the occlusion row's reading comes from, for its provenance chip. It
 * is named even while the row is UNKNOWN: the chip then says no time came
 * with it (amber), which is the truth.
 */
const OCCLUSION_SOURCE = "the runner's visibility sweep";

function HealthBadge({
  kind,
  reason,
}: {
  kind: PageHealthKind;
  reason?: string;
}) {
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
    ? [
        ...finding.quoted.errors,
        ...finding.quoted.loading,
        ...finding.quoted.empty,
      ]
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
            (presenting
              ? "No readable figures."
              : (finding.runnerDetail ?? "No readable figures."))}
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
      aria-label={`Where elements sit on the screen: ${
        rows
          .join("")
          .split("")
          .filter((c) => c === "#").length
      } of ${rows.length * width} cells hold an element`}
      data-testid="coord-ui-bridge-health-heatmap"
    >
      {rows.flatMap((row, y) =>
        [...row.padEnd(width, ".")].map((cell, x) => (
          <span
            key={`${y}-${x}`}
            className={
              cell === "#" ? "h-2 w-2 bg-foreground/50" : "h-2 w-2 bg-card"
            }
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
      icon={
        <Stethoscope className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      summary={
        // The header is visible while the panel is closed (R7), so it states
        // the read as it stands — never "not run" over a run that failed, and
        // never a kept verdict as if the latest run had confirmed it.
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-health-summary"
          data-read-state={
            pageHealth.state === "ok" && pageHealth.stale
              ? "stale"
              : pageHealth.state
          }
        >
          {pageHealth.state === "ok" ? (
            pageHealth.stale ? (
              <span className="inline-flex items-center gap-1.5">
                <HealthBadge
                  kind={pageHealth.value.summary}
                  reason={PAGE_HEALTH_EARLIER_RUN_REASON}
                />{" "}
                <span data-testid="coord-ui-bridge-health-summary-earlier">
                  from the earlier run
                </span>
              </span>
            ) : (
              <HealthBadge kind={pageHealth.value.summary} />
            )
          ) : pageHealth.state === "failed" ? (
            <HealthBadge
              kind="unknown"
              reason={PAGE_HEALTH_NO_READING_REASON}
            />
          ) : pageHealth.state === "loading" ? (
            "checking…"
          ) : (
            "not run"
          )}
        </span>
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
          title={PAGE_HEALTH_BUTTON_TITLE}
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
          Not run yet — page health reads the runner&apos;s live window, so it
          runs only when asked.
        </p>
      ) : (
        <>
          <section
            className="space-y-2"
            data-testid="coord-ui-bridge-health-report"
          >
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
                      <FindingLine
                        key={f.key}
                        finding={f}
                        presenting={presenting}
                      />
                    ))}
                  </ul>
                  {report.heatmap && <Heatmap rows={report.heatmap} />}
                </div>
              </>
            ) : null}
          </section>

          <section
            className="space-y-2"
            data-testid="coord-ui-bridge-occlusion-section"
          >
            {occlusion.state === "loading" ? (
              <p className="m-0 text-sm text-muted-foreground">
                Sweeping for occlusion…
              </p>
            ) : occlusion.state === "failed" ? (
              <>
                <RunnerReadUnknown
                  issue={occlusion.issue}
                  route={RUNNER_ROUTES.visibility}
                  build={build}
                  data-testid="coord-ui-bridge-occlusion-unknown"
                />
                <Provenance source={OCCLUSION_SOURCE} asOf={null} />
              </>
            ) : occlusion.state === "ok" ? (
              <>
                {occlusion.stale && (
                  <StaleReadNote
                    asOf={occlusion.asOf}
                    data-testid="coord-ui-bridge-occlusion-stale"
                  />
                )}
                <OcclusionRow reading={occlusion.value} />
                <Provenance source={OCCLUSION_SOURCE} asOf={occlusion.asOf} />
              </>
            ) : null}
          </section>
        </>
      )}
    </DashboardPanel>
  );
}
