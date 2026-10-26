"use client";

/**
 * The three record rows of `/admin/coord/session-load` — one work type, one
 * machine, one run — each an R2 line whose R5 detail carries the full figures
 * (every one with its unit), the drill-down action, and the raw ids last.
 */

import Link from "next/link";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  absoluteTime,
} from "@/components/console";
import {
  MACHINE_STATUS_PALETTE,
  RUN_STATUS_PALETTE,
  budgetText,
  concurrencyText,
  countText,
  deriveRunStatus,
  endReasonLabel,
  formatSeconds,
  formatSlotHours,
  heldShareText,
  initiatorLabel,
  openVsBudgetText,
  runLinks,
  runWallText,
  runsText,
  wallTimeText,
  workTypeLabel,
  type MachineLine,
  type SessionRunWire,
  type SparkPoint,
  type WorkTypeLine,
} from "../_lib/sessionLoadStatus";
import { OTHER_COLOR, Sparkline, StackedBar } from "./charts";

function DrillButton({
  onClick,
  children,
  "data-testid": testId,
}: {
  onClick: () => void;
  children: string;
  "data-testid"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium underline underline-offset-2 hover:no-underline"
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export function WorkTypeRow({
  line,
  spark,
  windowLabel,
  expanded,
  onToggle,
  onShowRuns,
}: {
  line: WorkTypeLine;
  /** Slot-hours per complete day over 90 days; `null` when growth did not answer. */
  spark: SparkPoint[] | null;
  windowLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onShowRuns: () => void;
}) {
  return (
    <RecordRow
      data-testid="coord-session-load-type-row"
      expanded={expanded}
      onToggle={onToggle}
      identity={
        <span title="runs started in the window">{runsText(line.runs)}</span>
      }
      label={
        <span title={line.description ?? line.workType}>
          <span
            className="font-medium"
            data-testid="coord-session-load-type-label"
          >
            {line.label}
          </span>
          <span
            className="text-muted-foreground"
            data-testid="coord-session-load-type-slot"
          >
            {" "}
            · {formatSlotHours(line.slotHours)}
          </span>
        </span>
      }
      reason={wallTimeText(line)}
      reasonTestId="coord-session-load-type-wall"
      time={
        spark === null ? (
          <span
            className="text-[11px] text-muted-foreground italic whitespace-nowrap"
            title="The 90-day growth read did not answer, so this work type's trend is unknown"
            data-testid="coord-session-load-type-spark-unknown"
          >
            trend unknown
          </span>
        ) : (
          <Sparkline
            points={spark}
            label={`${line.label}, slot-hours per day over 90 days`}
            data-testid="coord-session-load-type-spark"
          />
        )
      }
    >
      <RecordDetail
        data-testid="coord-session-load-type-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            {line.description ?? `Runs classified as ${line.workType}.`}
          </p>
        }
        problems={
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs m-0">
            <dt className="text-muted-foreground">
              Runs started in {windowLabel}
            </dt>
            <dd className="m-0" data-testid="coord-session-load-type-runs">
              {countText(line.runs)} ({countText(line.openNow)} still open)
            </dd>
            <dt className="text-muted-foreground">Wall time</dt>
            <dd className="m-0">{wallTimeText(line)}</dd>
            <dt className="text-muted-foreground">Slot-hours held</dt>
            <dd className="m-0">
              {formatSlotHours(line.slotHours)} (open and inferred runs
              included)
            </dd>
            <dt className="text-muted-foreground">Held after finish</dt>
            <dd className="m-0" data-testid="coord-session-load-type-held">
              {heldShareText(line.held)}
              {line.held.kind === "unknown" ? ` — ${line.held.reason}` : ""}
            </dd>
            <dt className="text-muted-foreground">Ends inferred</dt>
            <dd className="m-0" data-testid="coord-session-load-type-inferred">
              {runsText(line.inferred)} (excluded from wall time)
            </dd>
            <dt className="text-muted-foreground">Reconciled session ids</dt>
            <dd
              className="m-0"
              data-testid="coord-session-load-type-reconciled"
            >
              {runsText(line.reconciled)} (the runner reconciled their id; it
              may name a foreign session)
            </dd>
          </dl>
        }
        actions={
          <DrillButton
            onClick={onShowRuns}
            data-testid="coord-session-load-type-show-runs"
          >
            Show these runs
          </DrillButton>
        }
        raw={
          <p className="font-mono text-[10px] text-muted-foreground/60 m-0">
            work_type={line.workType}
          </p>
        }
      />
    </RecordRow>
  );
}

export function MachineRow({
  line,
  windowLabel,
  bucketLabel,
  colorOf,
  expanded,
  onToggle,
  onShowRuns,
}: {
  line: MachineLine;
  windowLabel: string;
  bucketLabel: string;
  colorOf: ReadonlyMap<string, string>;
  expanded: boolean;
  onToggle: () => void;
  onShowRuns: () => void;
}) {
  const budgetRef =
    line.budget.state === "published" ? line.budget.value : null;
  return (
    <RecordRow
      data-testid="coord-session-load-machine-row"
      expanded={expanded}
      onToggle={onToggle}
      attention={line.status.attention}
      identity={
        <span
          title="open runs now"
          data-testid="coord-session-load-machine-open"
        >
          {line.openNow === null ? "UNKNOWN" : `${line.openNow} open`}
        </span>
      }
      label={
        <span title={`${line.name} — ${openVsBudgetText(line)}`}>
          <span className="font-medium">{line.name}</span>
          <span
            className="text-muted-foreground"
            data-testid="coord-session-load-machine-budget"
          >
            {" "}
            · {budgetText(line.budget)}
          </span>
        </span>
      }
      status={
        <span
          data-testid="coord-session-load-machine-status"
          data-status={line.status.kind}
        >
          <StatusBadge status={line.status} palette={MACHINE_STATUS_PALETTE} />
        </span>
      }
      reason={concurrencyText(line, windowLabel)}
      reasonTestId="coord-session-load-machine-concurrency"
      time={
        <Sparkline
          points={line.peaks}
          label={`${line.name}, peak open runs per ${bucketLabel} bucket`}
          reference={budgetRef}
          data-testid="coord-session-load-machine-spark"
        />
      }
    >
      <RecordDetail
        data-testid="coord-session-load-machine-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            {openVsBudgetText(line)} — {line.status.reason}.
          </p>
        }
        problems={
          <div className="space-y-2 text-xs">
            <p className="m-0">
              {concurrencyText(line, windowLabel)}.{" "}
              {line.peaksUpperBound
                ? "Buckets older than 31 days come from the hourly rollup, whose peak is an upper bound (the sum of each work type's peak)."
                : ""}
            </p>
            <p className="m-0 text-muted-foreground">
              Last heartbeat:{" "}
              {line.heartbeatAgeSecs === null
                ? "unknown"
                : `${formatSeconds(line.heartbeatAgeSecs)} ago`}
              .
            </p>
            <div className="space-y-1">
              <p className="m-0 font-medium text-muted-foreground">
                Slot-hours by work type over {windowLabel}
              </p>
              {line.slices === null ? (
                <p
                  className="m-0 italic text-muted-foreground"
                  data-testid="coord-session-load-machine-slices-unknown"
                >
                  The per-machine work-type read did not answer — unknown, not
                  none.
                </p>
              ) : (
                <StackedBar
                  data-testid="coord-session-load-machine-slices"
                  unit="slot-h"
                  empty="No run on this machine held a slot in the window."
                  slices={line.slices.map((s) => ({
                    key: s.workType,
                    label: s.label,
                    value: s.slotHours,
                    color: colorOf.get(s.workType) ?? OTHER_COLOR,
                  }))}
                />
              )}
            </div>
          </div>
        }
        actions={
          <DrillButton
            onClick={onShowRuns}
            data-testid="coord-session-load-machine-show-runs"
          >
            Show this machine&apos;s runs
          </DrillButton>
        }
        raw={
          <p className="font-mono text-[10px] text-muted-foreground/60 m-0 break-all">
            device_id={line.deviceId}
          </p>
        }
      />
    </RecordRow>
  );
}

export function RunRow({
  run,
  deviceName,
  nowMs,
  expanded,
  onToggle,
}: {
  run: SessionRunWire;
  deviceName: string;
  nowMs: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveRunStatus(run);
  const links = runLinks(run);
  return (
    <RecordRow
      data-testid="coord-session-load-run-row"
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span title={`initiator: ${run.initiator}`}>
          {initiatorLabel(run.initiator)}
        </span>
      }
      label={
        <span title={`${workTypeLabel(run.work_type)} on ${deviceName}`}>
          <span className="font-medium">{workTypeLabel(run.work_type)}</span>
          <span className="text-muted-foreground"> · {deviceName}</span>
          {run.run_seq > 0 && (
            <span
              className="text-muted-foreground"
              title="a resumed run of the same session"
            >
              {" "}
              · resumed (run {run.run_seq + 1})
            </span>
          )}
        </span>
      }
      status={
        <span className="inline-flex items-center gap-1.5 shrink-0">
          <span
            data-testid="coord-session-load-run-status"
            data-status={status.kind}
          >
            <StatusBadge status={status} palette={RUN_STATUS_PALETTE} />
          </span>
          {run.history_complete === false && (
            <span
              className="text-[11px] text-muted-foreground italic whitespace-nowrap"
              title="Backfilled from records that predate the run record: its start, end and type facts are incomplete."
              data-testid="coord-session-load-run-backfilled"
            >
              backfilled
            </span>
          )}
        </span>
      }
      reason={runWallText(run, nowMs)}
      reasonTestId="coord-session-load-run-wall"
      time={<RowTime at={run.started_at} verb="Started" />}
    >
      <RecordDetail
        data-testid="coord-session-load-run-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            A {workTypeLabel(run.work_type)} run started by{" "}
            {initiatorLabel(run.initiator)} on {deviceName} at{" "}
            {absoluteTime(run.started_at)}
            {run.ended_at
              ? `, ended ${absoluteTime(run.ended_at)} — ${endReasonLabel(run.end_reason)}`
              : ", still open"}
            . {runWallText(run, nowMs)}
            {run.held_after_finish_seconds != null
              ? `; held its slot ${formatSeconds(run.held_after_finish_seconds)} after it declared itself finished`
              : ""}
            .
          </p>
        }
        problems={
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs m-0">
            {run.skill && (
              <>
                <dt className="text-muted-foreground">Skill</dt>
                <dd className="m-0">{run.skill}</dd>
              </>
            )}
            {run.first_command && (
              <>
                <dt className="text-muted-foreground">First command</dt>
                <dd className="m-0">/{run.first_command}</dd>
              </>
            )}
            {run.repo && (
              <>
                <dt className="text-muted-foreground">Repo</dt>
                <dd className="m-0">{run.repo}</dd>
              </>
            )}
            {run.model && (
              <>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="m-0">
                  {run.model}
                  {run.account_label ? ` · account ${run.account_label}` : ""}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Active time</dt>
            <dd className="m-0">{formatSeconds(run.active_seconds)}</dd>
          </dl>
        }
        actions={
          links.length === 0 ? (
            <p
              className="text-xs text-muted-foreground italic m-0"
              data-testid="coord-session-load-run-no-links"
            >
              This run names no gate, spawn request, session or work unit the
              console can open.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs m-0 p-0 list-none">
              {links.map((l) => (
                <li key={l.key}>
                  <Link
                    href={l.href}
                    className="font-medium underline underline-offset-2 hover:no-underline"
                    data-testid={`coord-session-load-run-link-${l.key}`}
                    title={l.id}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
        raw={
          <p className="font-mono text-[10px] text-muted-foreground/60 m-0 break-all">
            run={run.id} session={run.claude_code_session_id} seq={run.run_seq}{" "}
            device=
            {run.device_id}
            {run.gate_id ? ` gate=${run.gate_id}` : ""}
            {run.spawn_request_id
              ? ` spawn_request=${run.spawn_request_id}`
              : ""}
            {run.agent_id ? ` agent=${run.agent_id}` : ""}
            {run.end_source ? ` end_source=${run.end_source}` : ""}
            {run.close_reason ? ` close_reason=${run.close_reason}` : ""}
          </p>
        }
      />
    </RecordRow>
  );
}
