"use client";

/**
 * How one value of the spawn-path matrix renders — a gate's effective state,
 * its enforcement, a read-back mark, when the path last spawned.
 *
 * Colours come only from `console/statusRow` (style guide §4.1). A switch's
 * value is a setting in effect, not an alarm, so ON and OFF are both calm
 * (`INERT`); only what this page could not read is amber (`UNKNOWN_AMBER`,
 * R3's ignorance floor), and a write coord did not read back as asked is red
 * (`AUTHOR_RED`): nothing will clear it by itself, and the operator who made
 * it is the one who must look.
 */

import { Badge } from "@/components/ui/badge";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import { cn } from "@/lib/utils";
import type {
  GateCell,
  GateEnforcement,
  MatrixGate,
} from "../_lib/spawnPathGates";
import type { LastSpawnedCell } from "../_lib/spawnPathLastSpawned";

function toneClass(cell: GateCell): string {
  if (cell.tone === "contradiction") return AUTHOR_RED;
  if (cell.tone === "unknown" || cell.stale) return UNKNOWN_AMBER;
  return INERT;
}

/** A gate's value, as coord serves it — with a stale mark and the read-back. */
export function GateValue({
  cell,
  testId,
}: {
  cell: GateCell;
  testId?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 min-w-0">
      <Badge
        variant="outline"
        className={cn(
          "text-[11px] font-medium whitespace-normal",
          toneClass(cell)
        )}
        title={cell.title}
        data-testid={testId}
        data-gate-state={cell.state}
        data-gate-tone={cell.tone}
      >
        {cell.text}
        {cell.stale ? " (stale)" : ""}
      </Badge>
      {cell.readBack && (
        <span
          className="text-[11px] text-muted-foreground"
          data-testid={testId ? `${testId}-readback` : undefined}
          data-readback={cell.readBack.matches ? "matches" : "contradicts"}
        >
          {cell.readBack.matches
            ? `read back as asked (${cell.readBack.askedText})`
            : `you asked for ${cell.readBack.askedText}; coord reads back otherwise`}
        </span>
      )}
      {cell.writeNote && (
        <span
          className="text-[11px] text-muted-foreground"
          data-testid={testId ? `${testId}-write-note` : undefined}
        >
          {cell.writeNote}
        </span>
      )}
    </span>
  );
}

export function EnforcedValue({
  enforced,
  testId,
}: {
  enforced: GateEnforcement;
  testId?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-mono whitespace-nowrap",
        enforced.kind === "unknown" ? UNKNOWN_AMBER : INERT
      )}
      title={enforced.title}
      data-testid={testId}
      data-enforced={enforced.kind}
    >
      {enforced.text}
    </Badge>
  );
}

/** The class switches a mirror can carry (the contract's `spawn_paths`). */
const CLASS_ROWS: ReadonlySet<string> = new Set([
  "standing_continuation",
  "parallel_fanout",
  "in_session_subagent",
]);

/** The short name a secondary gate's chip carries on the path's line. */
export function gateChipLabel(gate: MatrixGate): string {
  const prefix = gate.key.split(":", 1)[0];
  switch (prefix) {
    case "mirror":
      return gate.mirrorOf !== undefined && CLASS_ROWS.has(gate.mirrorOf)
        ? "class"
        : "gate continuation";
    case "dial":
      return "dial";
    case "knob":
      return "knob";
    case "autonomy":
      return "autonomy";
    case "flag":
      return "flag";
    default:
      return gate.title.toLowerCase();
  }
}

/** A secondary gate on the path's own line: its short name and coord's value. */
export function GateChip({ gate }: { gate: MatrixGate }) {
  const cell = gate.effective;
  const value = cell.text.split(" · ", 1)[0] ?? cell.text;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-normal whitespace-nowrap",
        toneClass(cell)
      )}
      title={`${gate.title}: ${cell.text}${cell.title ? ` — ${cell.title}` : ""}`}
      data-testid="coord-spawns-path-chip"
      data-gate={gate.key}
      data-gate-state={cell.state}
    >
      {gateChipLabel(gate)} {value}
      {cell.stale ? " (stale)" : ""}
    </Badge>
  );
}

/**
 * The signed-in operator's own preference row, beside a value it does not
 * set (operator mode only: the gate carries it only then).
 */
export function PreferenceNote({
  cell,
  testId,
}: {
  cell: GateCell;
  testId?: string;
}) {
  return (
    <span
      className="text-[11px] text-muted-foreground"
      title={cell.title}
      data-testid={testId}
      data-preference={cell.state}
    >
      {cell.text}
      {cell.stale ? " (stale)" : ""}
    </span>
  );
}

/** When a path last started a session, or why the ledger cannot say. */
export function LastSpawnedValue({
  cell,
  presenting,
}: {
  cell: LastSpawnedCell;
  presenting: boolean;
}) {
  if (cell.kind === "unknown") {
    const reason = presenting ? cell.presentedReason : cell.reason;
    return (
      <span
        className="inline-flex"
        data-testid="coord-spawns-path-last"
        data-last-spawned="unknown"
        title={reason}
      >
        <Badge
          variant="outline"
          className={cn("text-[11px] font-medium", UNKNOWN_AMBER)}
        >
          UNKNOWN
        </Badge>
        <span className="sr-only"> {reason}</span>
      </span>
    );
  }
  if (cell.kind === "none") {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        data-testid="coord-spawns-path-last"
        data-last-spawned="none"
      >
        {cell.text}
        {cell.stale ? " (at the last good read)" : ""}
      </span>
    );
  }
  // A LOWER bound: the list holds only the requests made in its window, so a
  // request made earlier that started since is not on it.
  return (
    <span
      className="text-[11px] tabular-nums"
      data-testid="coord-spawns-path-last"
      data-last-spawned="spawned"
      title={`${absoluteTime(cell.at)} — the newest start among ${cell.measured}. A request made before them that started since is not in that list, so this path may have started more recently.`}
    >
      started {relativeTime(cell.at)} or more recently
      {cell.stale ? " (at the last good read)" : ""}
    </span>
  );
}
