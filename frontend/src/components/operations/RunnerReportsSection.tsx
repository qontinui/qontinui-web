"use client";

/**
 * The runner's own reports on a Dev Ops machine row — open wedge incidents
 * first and prominently, then the capability doctor's verdicts grouped by
 * state, INOPERATIVE first.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8. Presentation only: every decision — what `null` means, which
 * records are stale, which attention a state earns — is made once in
 * `runnerReportStatus.ts`, and this renders the result through the console's
 * own `StatusBadge` so its red means what red means everywhere else (style
 * guide R3).
 *
 * `null` renders "unknown — <reason>", never "none" and never a dash: a
 * report coord could not serve is the machine nothing measured.
 */

import { rowAccentClass, StatusBadge } from "@/components/console";
import { relativeTime } from "@/components/console/time";
import {
  CAPABILITY_PALETTE,
  WEDGE_PALETTE,
  type CapabilityKind,
  type RunnerReportView,
  type ResolvedRunnerReports,
} from "./runnerReportStatus";

const GROUP_HEADING: Record<CapabilityKind, string> = {
  inoperative: "Inoperative on this machine",
  degraded: "Degraded",
  unknown: "Unknown",
  operative: "Operative",
};

/** "unknown — <reason>", with the explanation one hover away. */
function UnknownLine({
  view,
  testId,
}: {
  view: Extract<RunnerReportView<unknown>, { state: "unknown" }>;
  testId: string;
}) {
  return (
    <p
      className="text-xs text-amber-200"
      title={view.detail}
      data-testid={testId}
      data-runner-report-state="unknown"
    >
      unknown — {view.reason}
    </p>
  );
}

/** The provenance line under a served report: age, staleness, refusals. */
function Provenance({
  view,
  nowMs,
  testId,
}: {
  view: Extract<RunnerReportView<unknown>, { state: "read" }>;
  nowMs?: number;
  testId: string;
}) {
  const parts: string[] = [
    view.receivedAt
      ? `reported ${relativeTime(view.receivedAt, { now: nowMs })}`
      : "report time unknown",
  ];
  if (view.stale) parts.push("stale — not re-reported recently");
  if (view.droppedEntries > 0)
    parts.push(`${view.droppedEntries} refused by coord`);
  if (view.omittedByRunner > 0)
    parts.push(`${view.omittedByRunner} left out by the runner`);
  return (
    <p
      className={`text-[11px] ${view.stale ? "text-amber-200" : "text-muted-foreground"}`}
      data-testid={testId}
      data-runner-report-stale={String(view.stale)}
    >
      {parts.join(" · ")}
    </p>
  );
}

export function RunnerReportsSection({
  reports,
  nowMs,
}: {
  reports: ResolvedRunnerReports;
  /** The page's clock; `undefined` reads the wall clock (as `MachineCard` does). */
  nowMs?: number;
}) {
  const { wedge, capability } = reports;
  return (
    <div className="space-y-2" data-testid="devops-runner-reports">
      <div data-testid="devops-runner-wedges">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Wedge incidents
        </h4>
        {wedge.state === "unknown" ? (
          <UnknownLine view={wedge} testId="devops-runner-wedges-unknown" />
        ) : (
          <>
            {wedge.items.open.length > 0 && (
              <ul
                className="space-y-1 mb-1"
                data-testid="devops-runner-wedges-open"
              >
                {wedge.items.open.map((w) => (
                  <li
                    key={`${w.incident.kind}-${w.incident.began_at}`}
                    className={`flex items-center gap-2 rounded-md border border-border bg-card/30 px-2 py-1 text-xs ${rowAccentClass(w)}`}
                    data-testid="devops-runner-wedge-open"
                    data-wedge-kind={w.incident.kind}
                  >
                    <StatusBadge status={w} palette={WEDGE_PALETTE} />
                    <span className="text-muted-foreground">
                      since{" "}
                      {relativeTime(w.incident.began_at, { now: nowMs })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p
              className="text-xs text-muted-foreground"
              data-testid="devops-runner-wedges-summary"
            >
              {wedge.items.open.length === 0
                ? "none open"
                : `${wedge.items.open.length} open`}
              {wedge.items.ended.length > 0 &&
                ` · ${wedge.items.ended.length} ended recently`}
            </p>
            <Provenance
              view={wedge}
              nowMs={nowMs}
              testId="devops-runner-wedges-provenance"
            />
          </>
        )}
      </div>

      <div data-testid="devops-runner-capability">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Capabilities
        </h4>
        {capability.state === "unknown" ? (
          <UnknownLine
            view={capability}
            testId="devops-runner-capability-unknown"
          />
        ) : capability.items.length === 0 ? (
          <>
            <p
              className="text-xs text-muted-foreground"
              data-testid="devops-runner-capability-empty"
            >
              the runner reported no mechanisms
            </p>
            <Provenance
              view={capability}
              nowMs={nowMs}
              testId="devops-runner-capability-provenance"
            />
          </>
        ) : (
          <>
            {capability.items.map((group) => (
              <div
                key={group.kind}
                className="mb-1"
                data-testid={`devops-runner-capability-group-${group.kind}`}
              >
                <p className="text-[11px] text-muted-foreground">
                  {GROUP_HEADING[group.kind]} ({group.rows.length})
                </p>
                <ul className="flex flex-wrap items-center gap-1">
                  {group.rows.map((row) => (
                    <li
                      key={row.mechanism}
                      data-capability-mechanism={row.mechanism}
                    >
                      <StatusBadge
                        status={{
                          ...row,
                          // The badge names the mechanism; the kind is the
                          // group heading above it and the badge's colour.
                          label: row.mechanism,
                        }}
                        palette={CAPABILITY_PALETTE}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Provenance
              view={capability}
              nowMs={nowMs}
              testId="devops-runner-capability-provenance"
            />
          </>
        )}
      </div>
    </div>
  );
}
