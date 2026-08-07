"use client";

/**
 * CI run panel — self-hosted CI occupancy per runner service (plan
 * `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C1 item 3).
 *
 * ## What this panel shows, and what it deliberately does not
 *
 * §C1 asks for "self-hosted jobs with which runner took them, queue wait, and
 * duration". Two of those four are reachable today and two are not, and the
 * gap is stated on the panel rather than filled in:
 *
 * - **Reachable.** `ci_jobs_running`, `build_slots_busy/total` and
 *   `build_queue_depth` ride the per-lane resource sample, and
 *   `lane_instance` names the publishing runner service. Each self-hosted
 *   host runs TWO GitHub Actions runner services inside the same WSL VM (one
 *   per repo) under the SAME agent name, which is exactly why the sample
 *   carries `"$RUNNER_NAME/<repo>"` rather than `$RUNNER_NAME` — the name
 *   alone cannot tell the two apart. So "which runner is busy right now"
 *   resolves; it resolves per service, not per host.
 * - **Not reachable.** Per-job queue wait and duration would come from
 *   `coord.ci_dispatches`, and coord exposes **no read route** for that table
 *   — its only HTTP surface is the two ingest POSTs. The CI-node lane is also
 *   still dark behind `COORD_CI_DISPATCH_TO_RUNNERS_ENABLED`, so the table is
 *   effectively empty. Rendering those columns from anything else available
 *   here would mean inventing them, which is the confidently-wrong dashboard
 *   this plan exists to end. The panel says so instead.
 *
 * Occupancy is read from the SAME rows the strip renders and the CI
 * dispatcher ranks on — not derived a second way.
 */

import { useMemo } from "react";
import { Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CollapsiblePanel } from "./CollapsiblePanel";
import {
  classifyFreshness,
  formatAge,
  formatPercent,
  safeRatio,
} from "./fleetResources";
import type { FleetDeviceRef, ResourceSampleRow } from "./fleetResources";

export interface CiRunPanelProps {
  /** The same `latest` rows the strip renders. */
  latest: ResourceSampleRow[];
  /** Coord's device list, for hostname display. */
  devices: FleetDeviceRef[];
  /** True when coord says the sample table has not been migrated yet. */
  schemaPending?: boolean;
  /**
   * Wall-clock seconds since `latest` arrived. Added to each row's frozen
   * server `age_secs` so a proxy outage ages these rows out instead of
   * pinning them at whatever they last said.
   */
  sinceFetchSecs?: number;
  /**
   * The shared poll's transport error, if any. Passed in because without it
   * this panel would render live-looking occupancy straight through an
   * outage with no indication anything was wrong.
   */
  error?: string | null;
}

/**
 * A row belongs on this panel when it reports CI occupancy: it carries
 * `ci_jobs_running`, or it is a `ci-step` publisher.
 *
 * `lane_instance != null` is deliberately NOT sufficient. That field means
 * "several publishers share this pool", which is true of the two co-resident
 * Actions runner services but would ALSO be true of two supervisors on one
 * host lane — and a build/agent lane listed under "CI runner load", with its
 * `build_slots_busy` relabelled "Slot occupancy", is a mislabel of exactly
 * the kind this surface exists to avoid.
 */
export function isCiPublishingRow(row: ResourceSampleRow): boolean {
  return row.ci_jobs_running != null || row.source === "ci-step";
}

export function CiRunPanel({
  latest,
  devices,
  schemaPending,
  sinceFetchSecs = 0,
  error,
}: CiRunPanelProps) {
  const hostnames = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of devices) {
      if (d.hostname) m.set(d.device_id, d.hostname);
    }
    return m;
  }, [devices]);

  const rows = useMemo(
    () =>
      latest
        .filter(isCiPublishingRow)
        .slice()
        .sort((a, b) =>
          (a.lane_instance ?? a.lane).localeCompare(b.lane_instance ?? b.lane)
        ),
    [latest]
  );

  // Only CURRENT rows contribute to the headline. A six-hour-old sample
  // adding to a badge on the collapsed header would read as live occupancy.
  const fresh = useMemo(
    () => rows.filter((r) => classifyFreshness(r, sinceFetchSecs) === "fresh"),
    [rows, sinceFetchSecs]
  );
  const totalRunning = fresh.reduce(
    (acc, r) => acc + (r.ci_jobs_running ?? 0),
    0
  );
  const notFresh = rows.length - fresh.length;

  return (
    // Self-provided so the panel renders outside the app layout too.
    <TooltipProvider delayDuration={100}>
      <CollapsiblePanel
        data-testid="ci-run-panel"
        storageKey="fleet:ci-runs"
        icon={<Server className="h-4 w-4" />}
        title="CI runner load"
        contentClassName="space-y-2"
        summary={
          <>
            <Badge variant="outline" className="ml-2">
              {rows.length} runner services
            </Badge>
            {fresh.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {totalRunning} running
              </Badge>
            )}
            {notFresh > 0 && (
              <Badge variant="outline" className="ml-1">
                {notFresh} unknown
              </Badge>
            )}
          </>
        }
      >
        {error && (
          <p className="text-sm text-destructive" data-testid="ci-run-error">
            Resource samples unavailable: {error}. Occupancy below is
            last-known, not current.
          </p>
        )}
        {schemaPending && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="ci-run-schema-pending"
          >
            coord reports <code>schema_pending</code> — no CI occupancy can
            exist yet. This is <strong>unknown</strong>, not idle.
          </p>
        )}

        {rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="ci-run-empty"
          >
            No runner service has published CI occupancy. That means unknown —
            not that no CI is running.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Runner service</th>
                  <th className="py-1 pr-3 font-medium">Machine</th>
                  <th className="py-1 pr-3 font-medium">Lane</th>
                  <th className="py-1 pr-3 font-medium">Jobs running</th>
                  <th className="py-1 pr-3 font-medium">Slot occupancy</th>
                  <th className="py-1 pr-3 font-medium">Queued</th>
                  <th className="py-1 pr-3 font-medium">Sample</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const freshness = classifyFreshness(r, sinceFetchSecs);
                  const occupancy = safeRatio(
                    r.build_slots_busy,
                    r.build_slots_total
                  );
                  return (
                    <tr
                      key={`${r.device_id}|${r.lane}|${r.lane_instance ?? ""}`}
                      className="border-t"
                      data-testid="ci-run-row"
                      data-freshness={freshness}
                    >
                      <td className="py-1.5 pr-3 font-mono text-[11px]">
                        {r.lane_instance ?? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground underline decoration-dotted">
                                sole publisher
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[20rem] text-[11px]">
                              This lane has no <code>lane_instance</code>,
                              meaning one publisher owns the whole pool (the
                              runner/supervisor case).
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px]">
                        {hostnames.get(r.device_id) ?? r.device_id}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {r.lane}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {freshness === "fresh" ? (
                          (r.ci_jobs_running ?? (
                            <span className="text-muted-foreground">
                              not reported
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">
                            unknown (stale)
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {occupancy == null ? (
                          <span className="text-muted-foreground">
                            not reported
                          </span>
                        ) : freshness === "fresh" ? (
                          <>
                            {r.build_slots_busy}/{r.build_slots_total} (
                            {formatPercent(occupancy)})
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            unknown ({freshness})
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {freshness !== "fresh" ? (
                          <span className="text-muted-foreground">unknown</span>
                        ) : (
                          (r.build_queue_depth ?? (
                            <span className="text-muted-foreground">—</span>
                          ))
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {freshness === "fresh" ? (
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {formatAge(r.age_secs)}
                          </span>
                        ) : (
                          <Badge
                            variant={
                              freshness === "unknown"
                                ? "outline"
                                : "destructive"
                            }
                          >
                            {freshness} · {formatAge(r.age_secs)}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p
          className="text-[10px] text-muted-foreground"
          data-testid="ci-run-missing-columns"
        >
          Per-job <strong>queue wait</strong> and <strong>duration</strong> are
          not shown because they are not available: they live in{" "}
          <code>coord.ci_dispatches</code>, which coord exposes no read route
          for, and the CI-node lane is still dark behind its dispatch flag.
          Occupancy above is the live per-lane sample — the same rows the CI
          dispatcher ranks on.
        </p>
      </CollapsiblePanel>
    </TooltipProvider>
  );
}
