"use client";

/**
 * Machines — one line per machine: whether it takes new work, the work it
 * may take, how much automated work it carries against its ceiling, and how
 * many sessions it has open now (`machineStatus.ts` derives every word).
 *
 * The in-flight column is coord's own count against its ceiling. What holds
 * across the machines (the total, the reasons work was held) or is unknown for
 * all of them is said ONCE above the lines (`machineListNote`), never as a
 * column of zeros.
 *
 * Machines are named through `MachineName` (D3.3): their real name for the
 * operator, their session alias ("Machine A") while presenting, from the one
 * registry every lens panel shares — and no device id renders while
 * presenting, in text or in a title. A line is one DEVICE, keyed on its device
 * id; when two lines would read the same, each carries what tells it apart
 * (`deviceDistinction.ts`): a short device id for the operator, "device 1/2"
 * while presenting.
 */

import { useMemo } from "react";
import { Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UNKNOWN_AMBER } from "@/components/console";
import {
  MachineName,
  SectionCaption,
  captionEntry,
  useDeviceOrdinals,
  useMachineAliaser,
  type SectionSource,
} from "@/components/presentation";
import { cn } from "@/lib/utils";
import { UnknownNote } from "./UnknownNote";
import { distinguishDevices } from "../_lib/deviceDistinction";
import type { MachineCell, MachineStatusLine } from "../_lib/machineStatus";

function CellValue({ cell, testId }: { cell: MachineCell; testId: string }) {
  if (cell.unknown) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "text-[11px] font-medium whitespace-normal",
          UNKNOWN_AMBER
        )}
        title={cell.title}
        data-testid={testId}
        data-machine-state={cell.state}
      >
        {cell.text}
      </Badge>
    );
  }
  return (
    <span
      className="text-xs"
      title={cell.title}
      data-testid={testId}
      data-machine-state={cell.state}
    >
      {cell.text}
    </span>
  );
}

export function MachineStatusSection({
  lines,
  listUnknown,
  listStale,
  presenting,
  sources,
  note,
}: {
  /** What holds across the machines, or is unknown for all of them. */
  note: { text: string; unknown: boolean };
  /** `null` while the roster is unknown — `listUnknown` says why. */
  lines: MachineStatusLine[] | null;
  listUnknown: string | null;
  /** The list is the last good read: why, or `null` when it is current. */
  listStale: string | null;
  presenting: boolean;
  sources: readonly SectionSource[];
}) {
  const title = captionEntry("agentic-activity.machines").title;
  const nameOf = useMachineAliaser();
  const ordinalOf = useDeviceOrdinals();
  const distinct = useMemo(
    () =>
      distinguishDevices(
        (lines ?? []).map((l) => ({
          deviceId: l.key,
          name: nameOf(l.identity),
        })),
        presenting,
        ordinalOf
      ),
    [lines, nameOf, ordinalOf, presenting]
  );
  return (
    <section
      className="space-y-2"
      data-testid="coord-spawns-machines-section"
      data-ui-bridge-id="coord-spawns-machines-section"
    >
      <SectionCaption
        id="agentic-activity.machines"
        sources={sources}
        data-testid="coord-spawns-machines-caption"
      />
      {!presenting && (
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
        </h2>
      )}
      {note.unknown ? (
        <UnknownNote role="status" data-testid="coord-spawns-inflight-note">
          {note.text}
        </UnknownNote>
      ) : (
        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="coord-spawns-inflight-note"
        >
          {note.text}
        </p>
      )}
      {listStale && (
        <UnknownNote role="status" data-testid="coord-spawns-machines-stale">
          {listStale}
        </UnknownNote>
      )}
      {lines === null ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-spawns-machines-unknown"
        >
          {listUnknown}
        </p>
      ) : lines.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="coord-spawns-machines-empty"
        >
          The fleet roster lists no machine.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            data-testid="coord-spawns-machine-table"
          >
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Machine</th>
                <th className="py-1 pr-3 font-medium">New work</th>
                <th className="py-1 pr-3 font-medium">
                  {presenting ? "Work it may take" : "Dispatch role"}
                </th>
                <th className="py-1 pr-3 font-medium">In flight vs ceiling</th>
                <th className="py-1 pr-3 font-medium">Sessions open now</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.key}
                  className="align-top border-t border-border"
                  data-testid="coord-spawns-machine"
                >
                  <td
                    className="py-1.5 pr-3 font-medium"
                    title={presenting ? undefined : line.key}
                  >
                    <MachineName
                      identity={line.identity}
                      data-testid="coord-spawns-machine-name"
                    />
                    {distinct.has(line.key) && (
                      <span
                        className={cn(
                          "ml-1.5 text-[11px] font-normal text-muted-foreground",
                          !presenting && "font-mono"
                        )}
                        data-testid="coord-spawns-machine-distinct"
                      >
                        {presenting ? ", " : "· "}
                        {distinct.get(line.key)}
                      </span>
                    )}
                    {line.stale && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "ml-1.5 text-[10px] font-medium",
                          UNKNOWN_AMBER
                        )}
                        title="From the last good read of the fleet roster."
                        data-testid="coord-spawns-machine-stale"
                      >
                        stale
                      </Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <CellValue
                      cell={line.drain}
                      testId="coord-spawns-machine-drain"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <CellValue
                      cell={line.role}
                      testId="coord-spawns-machine-role"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <CellValue
                      cell={line.inFlight}
                      testId="coord-spawns-machine-inflight"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <CellValue
                      cell={line.sessions}
                      testId="coord-spawns-machine-sessions"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
