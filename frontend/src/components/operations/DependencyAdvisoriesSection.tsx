"use client";

/**
 * The fleet Rust advisory census, one row per repo (plan
 * `2026-11-02-rust-advisories-have-no-fleet-consumer` Phase 5).
 *
 * Each row: the audited sha, the repo, coord's census state, the open
 * advisory count (neither ignored nor resolved), the advisory-DB commit the
 * audit read, and how old the census is — flagged stale past 36 h. Expanding
 * a row lists its open advisories (id, package, version, patched versions).
 *
 * ## What this section never renders as calm
 *
 * - A failed read (coord's `503 dependency_advisories_surface_unavailable`
 *   before its migration applies, a proxy failure, a body of another shape)
 *   with nothing read before: an explicit "census unavailable — UNKNOWN".
 * - A read that answered with no census rows: "no census recorded yet —
 *   UNKNOWN". A repo the census has not reached is not a clean repo.
 * - A row in state `unknown`: its count is `–`, and its reason is shown.
 * - A stale or undatable census: a `stale` badge and amber attention, whatever
 *   its state says.
 * - A verdict its own rows contradict (`clean` with an open advisory,
 *   `vulnerable` with none): amber, with the contradiction as its reason.
 * - A partial census as a clean fleet: rows exist only for repos coord holds a
 *   census for, so the header says the list covers recorded repos only and
 *   dates the newest row as "last census cycle" — stale-flagged past 36 h. No
 *   expected-repo list is invented client side.
 *
 * Only `ecosystem === "rust"` rows are read (the section is "Rust
 * advisories"), keyed `${repo}:${ecosystem}`.
 *
 * ## Operator-only
 *
 * The page mounts this under `{!presenting && …}`, so the presentation lens
 * never renders it: open advisories name exploitable packages in the tenant's
 * repos. The section owns its poll (as `FleetRolesSection` does), so
 * unmounting it means presentation mode makes no read for it at all.
 */

import { useMemo, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CollapsiblePanel,
  NAVIGATION_ONLY_PROPS,
  RecordDetail,
  RecordList,
  RecordRow,
} from "@/components/console";
import { formatAge } from "./fleetResources";
import {
  CENSUS_STALE_AFTER_SECS,
  censusRowKey,
  lastCensusCycle,
  rustCensusRows,
  shortSha,
  sortCensusViews,
  viewCensusRow,
  type CensusRowView,
} from "./dependencyAdvisories";
import { useDependencyAdvisories } from "./useDependencyAdvisories";

const STATE_BADGE: Record<
  CensusRowView["state"],
  {
    label: string;
    variant: "success" | "destructive" | "outline" | "warning" | "secondary";
  }
> = {
  clean: { label: "clean", variant: "success" },
  vulnerable: { label: "vulnerable", variant: "destructive" },
  not_applicable: { label: "not applicable", variant: "secondary" },
  unknown: { label: "unknown", variant: "warning" },
  unrecognised: { label: "unrecognised state", variant: "warning" },
};

const STALE_HOURS = CENSUS_STALE_AFTER_SECS / 3600;

function openCountText(view: CensusRowView): string {
  if (view.state === "not_applicable") return "n/a";
  if (view.openCount === null) return "– open";
  return `${view.openCount} open`;
}

/** The muted line under a row's reason: what the row cannot claim. */
function rowReason(view: CensusRowView): string | undefined {
  const parts: string[] = [];
  if (view.contradiction) parts.push(view.contradiction);
  if (view.state === "unknown" || view.state === "unrecognised") {
    parts.push(
      view.row.reason ??
        (view.state === "unknown"
          ? "coord recorded no reason"
          : `coord sent state "${view.row.state}"`)
    );
  }
  if (view.ageSecs === null) parts.push("census age unknown");
  else if (view.stale) parts.push(`census older than ${STALE_HOURS}h`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function CensusRow({
  view,
  expanded,
  onToggle,
}: {
  view: CensusRowView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = STATE_BADGE[view.state];
  const sha = shortSha(view.row.sha);
  const db = shortSha(view.row.db_commit);
  const reason = rowReason(view);
  return (
    <RecordRow
      data-testid="dependency-advisories-row"
      identity={sha ?? "no sha"}
      label={
        <>
          <span className="text-foreground/90">{view.row.repo}</span>
          <span
            className="text-muted-foreground font-mono text-xs"
            data-testid="dependency-advisories-db-commit"
          >
            {" "}
            · db {db ?? "unknown"}
          </span>
        </>
      }
      status={
        <span className="flex items-center gap-1 shrink-0">
          <Badge
            variant={badge.variant}
            className="text-xs"
            data-testid="dependency-advisories-state"
            data-state={view.state}
          >
            {badge.label}
          </Badge>
          <Badge
            variant="outline"
            className="text-xs"
            data-testid="dependency-advisories-open-count"
          >
            {openCountText(view)}
          </Badge>
          {view.stale && (
            <Badge
              variant="warning"
              className="text-xs"
              data-testid="dependency-advisories-stale"
            >
              stale
            </Badge>
          )}
        </span>
      }
      reason={reason}
      reasonTestId="dependency-advisories-reason"
      time={
        <span
          className="text-xs text-muted-foreground shrink-0"
          data-testid="dependency-advisories-age"
          title={view.row.observed_at ?? "no observed_at"}
        >
          {formatAge(view.ageSecs)}
        </span>
      }
      attention={view.attention}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RecordDetail
        data-testid="dependency-advisories-detail"
        why={
          reason ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="dependency-advisories-detail-reason"
            >
              {reason}
            </p>
          ) : undefined
        }
        problems={
          view.open.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {view.open.map((a) => (
                <li
                  key={`${a.advisory_id}:${a.package}:${a.version}`}
                  data-testid="dependency-advisories-advisory"
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <span className="font-mono font-medium">{a.advisory_id}</span>
                  <span>
                    {a.package} {a.version}
                  </span>
                  <span className="text-muted-foreground">
                    {a.patched.length > 0
                      ? `patched: ${a.patched.join(", ")}`
                      : "no patched release"}
                  </span>
                  {a.severity && (
                    <Badge variant="outline" className="text-[10px]">
                      {a.severity}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {view.openCount === null
                ? "No measured advisory list — this census did not complete."
                : "No open advisories on this census."}
            </p>
          )
        }
        raw={
          <p className="text-[11px] text-muted-foreground font-mono">
            sha {view.row.sha ?? "unknown"} · advisory DB{" "}
            {view.row.db_commit ?? "unknown"}
            {view.ignoredCount > 0 && ` · ${view.ignoredCount} ignored`}
          </p>
        }
      />
    </RecordRow>
  );
}

export function DependencyAdvisoriesSection({ nowMs }: { nowMs: number }) {
  const { data, loading, error, fetchedAtMs, refresh } =
    useDependencyAdvisories();

  const views = useMemo(
    () =>
      data
        ? sortCensusViews(
            rustCensusRows(data.census).map((row) =>
              viewCensusRow(row, nowMs, fetchedAtMs)
            )
          )
        : [],
    [data, nowMs, fetchedAtMs]
  );

  const counts = useMemo(() => {
    let vulnerable = 0;
    let unknown = 0;
    let stale = 0;
    for (const v of views) {
      if (v.state === "vulnerable") vulnerable += 1;
      if (v.state === "unknown" || v.state === "unrecognised") unknown += 1;
      if (v.stale) stale += 1;
    }
    return { vulnerable, unknown, stale };
  }, [views]);

  const cycle = useMemo(() => lastCensusCycle(views), [views]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Nothing read yet, and the read failed: the whole census is UNKNOWN.
  const unavailable = data === null && error !== null;
  // No Rust row: a body holding only other ecosystems is no Rust census.
  const empty = data !== null && views.length === 0;

  return (
    <CollapsiblePanel
      data-testid="dependency-advisories-section"
      storageKey="fleet:dependency-advisories"
      icon={<ShieldAlert className="h-4 w-4" />}
      title="Rust advisories"
      contentClassName="space-y-3"
      summary={
        unavailable || empty ? (
          <Badge
            variant="warning"
            className="ml-2"
            data-testid="dependency-advisories-unknown-badge"
          >
            unknown
          </Badge>
        ) : data ? (
          <>
            <Badge variant="outline" className="ml-2">
              {views.length} {views.length === 1 ? "repo" : "repos"}
            </Badge>
            {counts.vulnerable > 0 && (
              <Badge
                variant="destructive"
                className="ml-1"
                data-testid="dependency-advisories-vulnerable-badge"
              >
                {counts.vulnerable} vulnerable
              </Badge>
            )}
            {counts.unknown > 0 && (
              <Badge
                variant="warning"
                className="ml-1"
                data-testid="dependency-advisories-unknown-badge"
              >
                {counts.unknown} unknown
              </Badge>
            )}
            {counts.stale > 0 && (
              <Badge
                variant="warning"
                className="ml-1"
                data-testid="dependency-advisories-stale-badge"
              >
                {counts.stale} stale
              </Badge>
            )}
            <Badge
              variant={cycle.stale ? "warning" : "outline"}
              className="ml-1"
              data-testid="dependency-advisories-last-cycle"
              data-stale={cycle.stale ? "true" : "false"}
            >
              last census cycle {formatAge(cycle.ageSecs)}
              {cycle.stale && " · stale"}
            </Badge>
          </>
        ) : null
      }
      headerActions={
        <Button
          {...NAVIGATION_ONLY_PROPS}
          variant="ghost"
          size="sm"
          onClick={refresh}
          aria-label="Refresh Rust advisories"
          data-testid="dependency-advisories-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      }
    >
      {unavailable ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="dependency-advisories-unavailable"
        >
          <span className="font-medium text-foreground">
            Census unavailable — UNKNOWN.
          </span>{" "}
          {error}. This is not &quot;clean&quot; and not &quot;0
          advisories&quot;: nothing was read.
        </p>
      ) : (
        <>
          {error && (
            <p
              className="text-sm text-destructive"
              data-testid="dependency-advisories-error"
            >
              Rust advisories unavailable: {error}. Rows below are last-known,
              not current.
            </p>
          )}
          {!empty && data && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="dependency-advisories-scope-note"
            >
              Lists only repos with a recorded Rust census. A repo coord has
              never censused does not appear here, so this list is not the fleet
              and its rows are not a fleet-wide all-clear.
            </p>
          )}
          {loading && !data ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <RecordList
              items={views}
              itemKey={(v) => censusRowKey(v.row)}
              expandedKey={expandedKey}
              onExpandedKeyChange={setExpandedKey}
              empty={
                empty ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="dependency-advisories-empty"
                  >
                    <span className="font-medium text-foreground">
                      No census recorded yet — UNKNOWN.
                    </span>{" "}
                    Coord holds no Rust advisory census for any repo, so no
                    repo&apos;s advisory state is known. This is not
                    &quot;clean&quot;.
                  </p>
                ) : null
              }
              renderRow={(v, ctx) => (
                <CensusRow
                  view={v}
                  expanded={ctx.expanded}
                  onToggle={ctx.onToggle}
                />
              )}
            />
          )}
        </>
      )}
    </CollapsiblePanel>
  );
}
