"use client";

/**
 * The spawn-path matrix — every way a session gets started without someone
 * asking, one line per path (plan `2026-10-23-console-presentation-spaces`
 * Phase 4).
 *
 * A path's line shows its PRIMARY switch — a coord path's own agent-registry
 * row, the post-merge follow-up's per-repository scope, a runner path's
 * machine-local switch — in the matrix's five columns (switch, scope,
 * enforced?, effective state, last spawned), with every OTHER switch that
 * governs the path as a chip beside the effective state, each carrying its own
 * served value. Nothing is combined into one verdict (`spawnPathGates.ts`).
 * Opening the line (R5, one at a time) lists every switch in full, with its
 * control in operator mode.
 *
 * In presentation mode the section opens with its caption and the provenance
 * of each read; tokens (registry names, variables, routes) are not shown; and
 * no control is mounted — the disclosure is the only live element on a line.
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ToggleRight } from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Badge } from "@/components/ui/badge";
import { INERT } from "@/components/console";
import {
  OperatorOnly,
  SectionCaption,
  captionEntry,
  type SectionSource,
} from "@/components/presentation";
import type { AutonomyLevel } from "@/lib/api/operations/coordSettings";
import type { AutoFixPrChoice } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import { cn } from "@/lib/utils";
import type { MatrixGate } from "../_lib/spawnPathGates";
import type { MatrixRow, SpawnPathMatrix } from "../_lib/spawnPathMatrix";
import {
  EnforcedValue,
  GateChip,
  GateValue,
  LastSpawnedValue,
} from "./SpawnPathCells";
import {
  AutonomySwitch,
  FixerDialSwitch,
  RegistrySwitch,
  SetOnLink,
} from "./SpawnPathControls";

/** The writes a control may call — the switches hook's setters. */
export interface MatrixWriters {
  setRegistryDefault: (agentName: string, enabled: boolean) => Promise<void>;
  setAutonomyLevel: (domain: string, level: AutonomyLevel) => Promise<void>;
  setFixerDial: (choice: AutoFixPrChoice) => Promise<void>;
  /** Gate keys with a write in flight. */
  busy: ReadonlySet<string>;
}

const COLUMNS = [
  "Path",
  "Switch",
  "Scope",
  "Enforced?",
  "Effective state",
  "Last spawned",
] as const;

/** The disclosure on a path's line: navigation-only, so live in presentation. */
function PathToggle({
  row,
  open,
  onToggle,
}: {
  row: MatrixRow;
  open: boolean;
  onToggle: () => void;
}) {
  const { ref } = useUIElement({
    id: `coord-spawns-path-toggle-${row.key}`,
    label: `${open ? "Hide" : "Show"} every switch that governs "${row.label}" (changes only what is displayed)`,
    type: "disclosure",
  });
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex items-start gap-1 text-left font-medium"
      data-testid="coord-spawns-path-toggle"
    >
      {open ? (
        <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span>{row.label}</span>
    </button>
  );
}

/** One gate's control, or why it has none. */
function GateControl({
  row,
  gate,
  writers,
}: {
  row: MatrixRow;
  gate: MatrixGate;
  writers: MatrixWriters;
}) {
  const busy = writers.busy.has(gate.key);
  const control: ReactNode =
    gate.write === null ? null : gate.write.door === "registry" ? (
      <RegistrySwitch
        agentName={gate.write.agentName}
        pathLabel={row.label}
        current={gate.write.current}
        busy={busy}
        onSet={writers.setRegistryDefault}
      />
    ) : gate.write.door === "next_step" ? (
      <AutonomySwitch
        domain={gate.write.domain}
        pathLabel={row.label}
        level={gate.write.level}
        busy={busy}
        onSet={writers.setAutonomyLevel}
      />
    ) : (
      <FixerDialSwitch
        choice={gate.write.choice}
        busy={busy}
        onSet={writers.setFixerDial}
      />
    );
  return (
    <div className="space-y-1">
      {control !== null && <OperatorOnly>{control}</OperatorOnly>}
      {gate.readOnly && (
        <p
          className="m-0 text-[11px] text-muted-foreground"
          data-testid="coord-spawns-gate-readonly"
        >
          {gate.readOnly}
        </p>
      )}
      {gate.setOn && (
        <SetOnLink
          id={`coord-spawns-path-set-on-${row.key}`}
          href={gate.setOn.href}
          label={gate.setOn.label}
        />
      )}
    </div>
  );
}

/** Every switch that governs one path, in full. */
function GateTable({
  row,
  writers,
  presenting,
}: {
  row: MatrixRow;
  writers: MatrixWriters;
  presenting: boolean;
}) {
  return (
    <div className="space-y-2 py-2" data-testid="coord-spawns-path-detail">
      <p className="m-0 text-xs text-foreground/85">{row.summary}</p>
      {row.source === "contract" && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-spawns-path-contract-note"
        >
          {presenting
            ? "The coordination service did not list this path on its latest read, so every value for it is unknown."
            : `Coord's registry reads served no row named ${row.key}; it is listed from the spawn contract, and every value read from the registry is UNKNOWN.`}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="coord-spawns-gate-table">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Switch</th>
              <th className="py-1 pr-3 font-medium">Where it is set</th>
              <th className="py-1 pr-3 font-medium">Scope</th>
              <th className="py-1 pr-3 font-medium">Enforced?</th>
              <th className="py-1 pr-3 font-medium">Effective state</th>
              <th className="py-1 pr-3 font-medium">
                {presenting ? "Note" : "Control"}
              </th>
            </tr>
          </thead>
          <tbody>
            {row.gates.map((gate) => (
              <tr
                key={gate.key}
                className="align-top border-t border-border/50"
                data-testid="coord-spawns-gate"
                data-gate={gate.key}
              >
                <td className="py-1.5 pr-3 font-medium">{gate.title}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">
                  {gate.where}
                </td>
                <td className="py-1.5 pr-3">
                  <span data-testid="coord-spawns-gate-scope">{gate.scope}</span>
                  {gate.scopeNote && (
                    <span className="block text-[11px] text-muted-foreground">
                      {gate.scopeNote}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  <EnforcedValue
                    enforced={gate.enforced}
                    testId="coord-spawns-gate-enforced"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <div className="space-y-1">
                    <GateValue
                      cell={gate.effective}
                      testId="coord-spawns-gate-effective"
                    />
                    {gate.position && (
                      <GateValue
                        cell={gate.position}
                        testId="coord-spawns-gate-position"
                      />
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-3">
                  <GateControl row={row} gate={gate} writers={writers} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PathLine({
  row,
  open,
  onToggle,
  writers,
  presenting,
}: {
  row: MatrixRow;
  open: boolean;
  onToggle: () => void;
  writers: MatrixWriters;
  presenting: boolean;
}) {
  const [primary, ...others] = row.gates;
  if (!primary) return null;
  return (
    <Fragment>
      <tr
        className="align-top border-t border-border"
        data-testid="coord-spawns-path-row"
        data-path={row.key}
        data-path-source={row.source}
      >
        <td className="py-1.5 pr-3">
          <PathToggle row={row} open={open} onToggle={onToggle} />
          <span className="mt-0.5 flex flex-wrap gap-1 pl-[1.125rem]">
            {row.startedBy === "runner" && (
              <Badge variant="outline" className={cn("text-[10px]", INERT)}>
                started by each machine
              </Badge>
            )}
            {row.isClass && (
              <Badge variant="outline" className={cn("text-[10px]", INERT)}>
                class switch
              </Badge>
            )}
            {!presenting && row.startedBy === "coord" && (
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {row.key}
              </span>
            )}
          </span>
        </td>
        <td className="py-1.5 pr-3" data-testid="coord-spawns-path-switch">
          {primary.title}
          {others.length > 0 && (
            <span className="block text-[11px] text-muted-foreground">
              and {others.length} more switch{others.length === 1 ? "" : "es"}
            </span>
          )}
        </td>
        <td className="py-1.5 pr-3" data-testid="coord-spawns-path-scope">
          {primary.scope}
        </td>
        <td className="py-1.5 pr-3">
          <EnforcedValue
            enforced={primary.enforced}
            testId="coord-spawns-path-enforced"
          />
        </td>
        <td className="py-1.5 pr-3">
          <div className="flex flex-col gap-1">
            <GateValue
              cell={primary.effective}
              testId="coord-spawns-path-effective"
            />
            {others.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {others.map((g) => (
                  <GateChip key={g.key} gate={g} />
                ))}
              </span>
            )}
          </div>
        </td>
        <td className="py-1.5 pr-3">
          <LastSpawnedValue cell={row.lastSpawned} presenting={presenting} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS.length} className="pl-[1.125rem] pr-3">
            <GateTable row={row} writers={writers} presenting={presenting} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function SpawnPathMatrixSection({
  matrix,
  writers,
  presenting,
  sources,
}: {
  matrix: SpawnPathMatrix;
  writers: MatrixWriters;
  presenting: boolean;
  sources: readonly SectionSource[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const title = captionEntry("agentic-activity.spawn-paths").title;
  const counts = useMemo(() => {
    const coord = matrix.rows.filter((r) => r.startedBy === "coord").length;
    return { coord, runner: matrix.rows.length - coord };
  }, [matrix.rows]);
  return (
    <section
      className="space-y-2"
      data-testid="coord-spawns-paths-section"
      data-ui-bridge-id="coord-spawns-paths-section"
    >
      <SectionCaption
        id="agentic-activity.spawn-paths"
        sources={sources}
        data-testid="coord-spawns-paths-caption"
      />
      {!presenting && (
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <ToggleRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
        </h2>
      )}
      <p
        className="text-xs text-muted-foreground m-0"
        data-testid="coord-spawns-paths-note"
      >
        {counts.coord} paths the coordination service starts and {counts.runner}{" "}
        each machine starts on its own. Each switch shows the value its own
        source serves; a path governed by several switches lists them all and
        this page does not combine them — the coordination service refuses a
        path&apos;s spawn when its own switch or its class switch is off.
        {!presenting && matrix.roleRows !== null && matrix.roleRows > 0
          ? ` ${matrix.roleRows} further registry row${matrix.roleRows === 1 ? " is an agent role" : "s are agent roles"} that sessions call on, not spawn paths; they are set on the agent registry page.`
          : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="coord-spawns-path-table">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              {COLUMNS.map((c) => (
                <th key={c} className="py-1 pr-3 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <PathLine
                key={row.key}
                row={row}
                open={openKey === row.key}
                onToggle={() =>
                  setOpenKey((k) => (k === row.key ? null : row.key))
                }
                writers={writers}
                presenting={presenting}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
