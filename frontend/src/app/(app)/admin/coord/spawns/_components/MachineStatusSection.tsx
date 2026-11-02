"use client";

/**
 * Machines — one line per machine: whether it takes new work, the work it
 * may take, how much automated work it carries against its ceiling, and how
 * many sessions it has open now (`machineStatus.ts` derives every word).
 *
 * The in-flight column has no source the console can read yet, so the list
 * says so ONCE above its lines and each line's cell repeats it in its title —
 * the §3.8 "a fact the wire does not serve yet, stated once for the list"
 * pattern, never a column of zeros.
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
import {
  IN_FLIGHT_UNKNOWN,
  type MachineCell,
  type MachineStatusLine,
} from "../_lib/machineStatus";

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
  showInFlight = true,
}: {
  /**
   * `false` while coord does not serve the spawn ledger: the page's one
   * statement of that names the in-flight figure too (`LedgerUnservedNotice`).
   */
  showInFlight?: boolean;
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
      {showInFlight && (
        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="coord-spawns-inflight-note"
        >
          In flight against ceiling, and the reasons work was held: UNKNOWN —{" "}
          {presenting
            ? IN_FLIGHT_UNKNOWN.presented
            : IN_FLIGHT_UNKNOWN.operator}
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
                {showInFlight && (
                  <th className="py-1 pr-3 font-medium">
                    In flight vs ceiling
                  </th>
                )}
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
                  {showInFlight && (
                    <td className="py-1.5 pr-3">
                      <CellValue
                        cell={line.inFlight}
                        testId="coord-spawns-machine-inflight"
                      />
                    </td>
                  )}
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
