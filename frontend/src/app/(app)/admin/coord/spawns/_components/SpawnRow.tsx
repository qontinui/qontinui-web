"use client";

/**
 * One spawn request: an R2 row (class, origin and device(s), status, time to
 * spawn, requested) whose R5 detail carries the plain-language account, the
 * device history from `GET /spawns/{id}`, and the raw ids last.
 *
 * The device list never overflows its row: on the row it is one truncating
 * span whose `title` holds every device, and in the detail it is a wrapping
 * list.
 *
 * In presentation mode (plan `2026-10-23-console-presentation-spaces` D3.3)
 * every device reads as its session alias (`naming`), no device id appears in
 * text or in a title, coord's own words — a terminal reason, an event's
 * reason, an unrecognised token — are not quoted, the admission class reads as
 * words, and the raw ids line is not rendered (`OperatorOnly`).
 */

import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  absoluteTime,
} from "@/components/console";
import { OperatorOnly, usePresentationMode } from "@/components/presentation";
import {
  SPAWN_STATUS_PALETTE,
  deriveSpawnStatus,
  eventKindLabel,
  originLabel,
  placementBasisLabel,
  rowDevices,
  spawnIssueTextFor,
  timeToSpawnText,
  type DeviceNaming,
  type SpawnEventWire,
  type SpawnRowWire,
} from "../_lib/spawnStatus";
import { useSpawnDetail } from "../_lib/useSpawnLedger";

/** A wire token in words: an outsider reads `continuation`, not `re_try_class`. */
function tokenWords(token: string): string {
  return token.replace(/[_-]+/g, " ").trim();
}

/** The row's device words: `msi-wsl → pinned to spaceship`. */
function devicesText(row: SpawnRowWire, naming: DeviceNaming): string {
  const devices = rowDevices(row);
  if (devices.length === 0) return "no device yet";
  return devices.map((d) => `${d.role} ${naming.nameOf(d.id)}`).join(" · ");
}

function devicesTitle(row: SpawnRowWire, naming: DeviceNaming): string {
  const devices = rowDevices(row);
  if (devices.length === 0) return "no device has been chosen for this request";
  return devices
    .map(
      (d) =>
        `${d.role} ${naming.nameOf(d.id)}${naming.showIds ? ` (${d.id})` : ""}`
    )
    .join("\n");
}

function Timeline({
  spawnId,
  version,
  naming,
  presenting,
}: {
  spawnId: string;
  version: string;
  naming: DeviceNaming;
  presenting: boolean;
}) {
  const read = useSpawnDetail(spawnId, version);
  if (read.kind === "loading") {
    return (
      <p
        className="text-xs text-muted-foreground m-0"
        data-testid="coord-spawn-timeline-loading"
      >
        Reading where this request was sent…
      </p>
    );
  }
  if (read.kind === "issue") {
    return (
      <p
        className="text-xs text-amber-200 m-0"
        data-testid="coord-spawn-timeline-unknown"
        data-issue={read.issue.kind}
      >
        {spawnIssueTextFor(
          read.issue,
          "where this request was sent",
          presenting
        )}
      </p>
    );
  }
  const events: SpawnEventWire[] = read.detail.events;
  return (
    <div className="space-y-1" data-testid="coord-spawn-timeline">
      <p className="text-xs font-medium text-muted-foreground m-0">
        Where it was sent
      </p>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic m-0">
          No events were recorded for this request.
        </p>
      ) : (
        <ol className="space-y-0.5 text-xs">
          {events.map((e, i) => (
            <li
              key={`${e.at}:${e.kind}:${i}`}
              className="flex flex-wrap items-baseline gap-x-2 min-w-0"
              data-testid="coord-spawn-event"
              data-event-kind={e.kind}
            >
              <span
                className="tabular-nums text-muted-foreground shrink-0"
                title={e.at}
              >
                {absoluteTime(e.at)}
              </span>
              <span
                className="font-medium"
                title={presenting ? undefined : e.kind}
              >
                {eventKindLabel(e.kind)}
              </span>
              {e.device_id && (
                <span
                  className="min-w-0 break-all"
                  title={naming.showIds ? e.device_id : undefined}
                >
                  {naming.nameOf(e.device_id)}
                </span>
              )}
              {e.reason && (
                <OperatorOnly>
                  <span className="min-w-0 break-words text-muted-foreground">
                    {e.reason}
                  </span>
                </OperatorOnly>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SpawnRow({
  row,
  expanded,
  onToggle,
  naming,
  nowMs,
}: {
  row: SpawnRowWire;
  expanded: boolean;
  onToggle: () => void;
  naming: DeviceNaming;
  nowMs: number;
}) {
  const { presenting } = usePresentationMode();
  const status = deriveSpawnStatus(row, nowMs, { quoteCoord: !presenting });
  const devices = rowDevices(row);
  const wait = timeToSpawnText(row, nowMs);
  const cls = presenting ? tokenWords(row.class) : row.class;
  return (
    <RecordRow
      data-testid="coord-spawn-row"
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span title={presenting ? undefined : `admission class: ${row.class}`}>
          {cls}
        </span>
      }
      label={
        <span
          title={`${originLabel(row.origin)} — ${devicesTitle(row, naming)}`}
        >
          <span className="font-medium">{originLabel(row.origin)}</span>
          <span
            className="text-muted-foreground"
            data-testid="coord-spawn-devices"
          >
            {" "}
            · {devicesText(row, naming)}
          </span>
        </span>
      }
      status={
        <span className="inline-flex items-center gap-1.5 shrink-0">
          <span data-testid="coord-spawn-status" data-status={status.kind}>
            <StatusBadge status={status} palette={SPAWN_STATUS_PALETTE} />
          </span>
          {row.history_complete === false && (
            <span
              className="text-[11px] text-muted-foreground italic whitespace-nowrap"
              title="Backfilled from records that predate the spawn ledger: this request's device history is incomplete."
              data-testid="coord-spawn-history-partial"
            >
              history partial
            </span>
          )}
        </span>
      }
      reason={wait}
      reasonTestId="coord-spawn-wait"
      time={<RowTime at={row.requested_at} verb="Requested" />}
    >
      <RecordDetail
        data-testid="coord-spawn-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            A {cls} spawn requested by {originLabel(row.origin)} at{" "}
            {absoluteTime(row.requested_at)}: {status.label.toLowerCase()} —{" "}
            {status.reason}. Time to spawn: {wait}.
          </p>
        }
        problems={
          <div className="space-y-1 text-xs">
            {row.history_complete === false && (
              <p
                className="m-0 text-muted-foreground"
                data-testid="coord-spawn-history-partial-note"
              >
                History partial: this request was backfilled from records that
                predate the spawn ledger, so the timeline below is incomplete.
              </p>
            )}
            <p className="m-0 text-muted-foreground">
              {row.attempts} attempt{row.attempts === 1 ? "" : "s"} ·{" "}
              {row.deferrals} deferral{row.deferrals === 1 ? "" : "s"} ·
              placement: {placementBasisLabel(row.placement_basis)}
            </p>
            {devices.length > 0 && (
              <ul
                className="m-0 flex flex-wrap gap-x-3 gap-y-0.5"
                data-testid="coord-spawn-device-list"
              >
                {devices.map((d) => (
                  <li
                    key={d.id}
                    className="min-w-0 break-all"
                    title={naming.showIds ? d.id : undefined}
                  >
                    {d.role} {naming.nameOf(d.id)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
        history={
          <Timeline
            spawnId={row.id}
            version={row.updated_at}
            naming={naming}
            presenting={presenting}
          />
        }
        raw={
          <OperatorOnly>
            <p
              className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all"
              data-testid="coord-spawn-raw"
            >
              spawn_request: {row.id} · state: {row.state}
              {row.session_outcome
                ? ` · session_outcome: ${row.session_outcome}`
                : ""}
              {row.source_ref ? ` · source_ref: ${row.source_ref}` : ""}
              {row.claude_code_session_id
                ? ` · session: ${row.claude_code_session_id}`
                : ""}
              {row.claude_account ? ` · account: ${row.claude_account}` : ""}
              {row.lease_id ? ` · lease: ${row.lease_id}` : ""}
            </p>
          </OperatorOnly>
        }
      />
    </RecordRow>
  );
}
