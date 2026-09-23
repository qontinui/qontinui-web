"use client";

/**
 * "How much of each role, phase by phase" — the FTE matrix, with a column
 * total per phase and the busiest phase marked.
 *
 * Shading carries the same information as the number, never instead of it:
 * every cell prints its figure, and the peak column is marked with a word as
 * well as a tint, so the table is readable in monochrome and to a screen
 * reader.
 *
 * An empty cell means the role is not on that phase. That is NOT an
 * allocation of zero, so it renders blank rather than "0".
 */

import { formatDecimal, toNumber } from "@/components/overview/money";
import type {
  AllocationRead,
  RollupPhase,
  RollupRole,
} from "../../_lib/estimate-api";

export function FteMatrix({
  phases,
  roles,
  allocations,
  peakPhaseCode,
}: {
  phases: RollupPhase[];
  roles: RollupRole[];
  allocations: AllocationRead[];
  peakPhaseCode: string | null;
}) {
  const byCell = new Map<string, string>();
  for (const a of allocations) {
    byCell.set(`${a.phase_code}:${a.role_code}`, a.fte);
  }
  const allocatedRoles = roles.filter((role) =>
    phases.some((phase) => byCell.has(`${phase.code}:${role.code}`))
  );

  if (phases.length === 0 || allocatedRoles.length === 0) {
    return (
      <p
        className="text-[15px] leading-relaxed text-muted-foreground"
        data-ui-bridge-id="overview.team.fte.empty"
      >
        Nobody has been allocated to a phase yet. Team size is not known for
        this project &mdash; which is not the same as a team of none.
      </p>
    );
  }

  const columnTotal = (phase: RollupPhase) =>
    toNumber(phase.allocated_fte) ?? 0;
  const peak = Math.max(...phases.map(columnTotal));

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[36rem] border-collapse text-sm"
        data-ui-bridge-id="overview.team.fte"
      >
        <caption className="sr-only">
          People per role for each phase, measured in full-time equivalents.
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="py-2 pr-4 text-left font-medium text-muted-foreground"
            >
              Role
            </th>
            {phases.map((phase) => (
              <th
                key={phase.id}
                scope="col"
                className="px-3 py-2 text-right font-medium text-muted-foreground"
                title={phase.name}
              >
                {phase.code}
                {phase.code === peakPhaseCode && (
                  <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-primary">
                    peak
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allocatedRoles.map((role) => (
            <tr
              key={role.id}
              className="border-b border-border/60"
              data-ui-bridge-id={`overview.team.fte.row.${role.code}`}
            >
              <th
                scope="row"
                className="py-2 pr-4 text-left font-normal text-foreground"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {role.code}
                </span>{" "}
                {role.name}
              </th>
              {phases.map((phase) => {
                const value = byCell.get(`${phase.code}:${role.code}`);
                const share =
                  value && peak > 0 ? (toNumber(value) ?? 0) / peak : 0;
                return (
                  <td
                    key={phase.id}
                    className="px-3 py-2 text-right tabular-nums text-foreground"
                    // Shade by share of the busiest PHASE's total, never
                    // instead of the number itself — so the tint reads as
                    // "how much of the project's peak is this cell".
                    style={
                      value
                        ? {
                            backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(
                              Math.min(share, 1) * 22
                            )}%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {value ? formatDecimal(value, 3) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <th
              scope="row"
              className="py-2 pr-4 text-left font-medium text-foreground"
            >
              People on the phase
            </th>
            {phases.map((phase) => (
              <td
                key={phase.id}
                className={`px-3 py-2 text-right tabular-nums ${
                  phase.code === peakPhaseCode
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
                data-ui-bridge-id={`overview.team.fte.total.${phase.code}`}
              >
                {formatDecimal(phase.allocated_fte, 3) ?? ""}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
