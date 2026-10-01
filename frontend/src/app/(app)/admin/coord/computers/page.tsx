"use client";

/**
 * /admin/coord/computers — every computer the tenant's runners report, as a
 * first-class record: capacity, current usage per lane, watched services,
 * last event, the devices and CI runners on it, and freshness.
 *
 * Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5. Reads coord's `GET /coord/computers` (the
 * plan's Phase 3.2) through the web backend's passthrough proxy
 * (`useComputers`). One poll, and the strip is derived from it (R1).
 *
 * ## What this page will not say
 *
 * - **"Healthy" about a computer whose report is old.** A computer is `stale`
 *   past 3 × its 300 s cadence and `unknown` with no datable report — both
 *   amber, both counted on the strip, and its figures are labelled "last
 *   known" rather than rendered in a current slot (plan §3.5.1).
 * - **"No computers" when coord did not answer.** A coord predating the route
 *   (404), a `schema_pending` answer, a deadline or a transport failure is an
 *   explicit UNKNOWN banner above whatever the last good read held.
 * - **"No failed services" when coord sent no count.** `services_failed: null`
 *   is `services unknown`, never green.
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`): no page title
 * (R9), strip first (R1), one line per computer (R2) whose detail expands in
 * place (R5) and carries an "Open full page ↗" link to the drill-down, which
 * earns a route because it is a workspace of its own (services, events,
 * history, workloads, divergence).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Server } from "lucide-react";
import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  StatusBadge,
  absoluteTime,
  relativeTime,
  rowAccentClass,
} from "@/components/console";
import {
  COMPUTER_PALETTE,
  ambiguousClaimants,
  buildComputerRows,
  ciRunnerStatusText,
  computerHref,
  computerName,
  deriveComputersHealth,
  eventLabel,
  eventSubject,
  type AmbiguousCiRunnerWire,
  type CiRunnerWire,
  type ComputerRowModel,
  type NormalizedComputer,
} from "./_lib/computerStatus";
import { COMPUTERS_POLL_MS, useComputers } from "./_lib/useComputers";
import {
  CapacityStats,
  FreshnessBadge,
  LaneTable,
  ReadIssueBanner,
} from "./_components/ComputerParts";

function ComputerRow({
  row,
  expanded,
  onToggle,
  fetchedAtMs,
  nowMs,
}: {
  row: ComputerRowModel;
  expanded: boolean;
  onToggle: () => void;
  fetchedAtMs: number | null;
  nowMs: number;
}) {
  const { computer, freshness, status } = row;
  return (
    <RecordRow
      data-testid="coord-computer-row"
      rowKey={computer.computerId}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span className="font-mono text-[11px]" title={computer.kind}>
          {computer.kind}
        </span>
      }
      label={
        <span title={computerName(computer)}>
          <span className="font-medium">{computerName(computer)}</span>
          {computer.os && (
            <span className="text-muted-foreground"> · {computer.os}</span>
          )}
        </span>
      }
      status={
        <span className="inline-flex items-center gap-1.5">
          <span data-testid="coord-computer-status" data-status={status.kind}>
            <StatusBadge status={status} palette={COMPUTER_PALETTE} />
          </span>
          <FreshnessBadge reading={freshness} />
        </span>
      }
      reason={status.reason}
      reasonTestId="coord-computer-reason"
      time={
        <span
          className="text-xs text-muted-foreground shrink-0"
          title={absoluteTime(computer.freshness?.last_report_at ?? null)}
        >
          {relativeTime(computer.freshness?.last_report_at ?? null, {
            absent: "no report time",
          })}
        </span>
      }
    >
      <RecordDetail
        data-testid="coord-computer-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">{status.reason}</p>
        }
        problems={
          <div className="space-y-2">
            <CapacityStats computer={computer} />
            <LaneTable
              computer={computer}
              computerFreshness={freshness}
              fetchedAtMs={fetchedAtMs}
              nowMs={nowMs}
              showSparkline={false}
            />
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="coord-computer-last-event"
            >
              Last event:{" "}
              {computer.lastEvent === null
                ? "none in the retention window"
                : `${eventLabel(computer.lastEvent.kind)}${eventSubject(computer.lastEvent) ? ` (${eventSubject(computer.lastEvent)})` : ""}, ${relativeTime(computer.lastEvent.observed_at)}`}
              {" · "}
              Devices: {computer.devices?.length ?? "unknown"} · CI runners:{" "}
              {computer.ciRunners?.length ?? "unknown"}
            </p>
          </div>
        }
        actions={
          <Link
            href={computerHref(computer.computerId)}
            className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
            data-testid="coord-computer-open"
          >
            Open full page <ExternalLink className="h-3 w-3" />
          </Link>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            computer_id: {computer.computerId}
            {computer.parentComputerId
              ? ` · parent: ${computer.parentComputerId}`
              : ""}
          </p>
        }
      />
    </RecordRow>
  );
}

function AmbiguousRunners({
  runners,
  computers,
  retained,
}: {
  runners: AmbiguousCiRunnerWire[] | null;
  computers: NormalizedComputer[];
  retained: boolean;
}) {
  if (runners === null) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="coord-computers-ambiguous-unknown"
      >
        Coord could not read the CI registrar, so whether any runner is claimed
        by more than one computer is unknown — not none.
      </p>
    );
  }
  if (runners.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="coord-computers-ambiguous-none"
      >
        No CI runner is claimed by more than one computer
        {retained ? " at the last good read" : ""}.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="coord-computers-ambiguous-list">
      {runners.map((r) => (
        <li
          key={`${r.device_id}:${r.host_key}`}
          className={`flex flex-wrap items-center gap-x-3 px-3 py-2 text-sm rounded-md border border-border bg-card/30 ${rowAccentClass({ attention: "waiting" })}`}
          data-testid="coord-computers-ambiguous-row"
        >
          <span className="font-mono text-[11px]">
            {r.runner_name ?? r.host_key}
          </span>
          <span className="text-muted-foreground text-xs truncate">
            {r.repo ?? "repo not reported"}
          </span>
          <span
            className="text-xs"
            data-testid="coord-computers-ambiguous-claimants"
          >
            claimed by {ambiguousClaimants(r, computers).join(", ")}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {ciRunnerStatusText(r)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function UnattributedRunners({
  runners,
  retained,
}: {
  runners: CiRunnerWire[] | null;
  /** The latest read failed; this is the last good read's answer. */
  retained: boolean;
}) {
  if (runners === null) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="coord-computers-unattributed-unknown"
      >
        Coord could not read the CI registrar, so which runners are unattributed
        is unknown — not none.
      </p>
    );
  }
  if (runners.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="coord-computers-unattributed-none"
      >
        Every CI runner the registrar knows is claimed by a reporting computer
        {retained ? " at the last good read" : ""}.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="coord-computers-unattributed-list">
      {runners.map((r, i) => (
        <li
          key={`${r.runner_name ?? "unnamed"}:${r.repo ?? ""}:${i}`}
          className="flex items-center gap-3 px-3 py-2 text-sm rounded-md border border-border bg-card/30"
          data-testid="coord-computers-unattributed-row"
        >
          <span className="font-mono text-[11px]">
            {r.runner_name ?? "unnamed runner"}
          </span>
          <span className="text-muted-foreground text-xs truncate">
            {r.repo ?? "repo not reported"}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {ciRunnerStatusText(r)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function CoordComputersPage() {
  const read = useComputers();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // The page's clock, advanced independently of the read: a computer goes
  // stale by TIME, and the computer that stopped reporting is exactly the one
  // that sends nothing to re-render the page.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(
    () => buildComputerRows(read.data, read.fetchedAtMs, nowMs),
    [read.data, read.fetchedAtMs, nowMs]
  );
  const loaded = read.data !== null;
  // `registrar_read_ok: false` = coord's registrar read failed, so the
  // (empty) unattributed list it sent beside it is UNKNOWN, not "none".
  const unattributed: CiRunnerWire[] | null =
    read.data?.registrar_read_ok === false
      ? null
      : (read.data?.unattributed_ci_runners ?? null);
  const ambiguous: AmbiguousCiRunnerWire[] | null =
    read.data?.registrar_read_ok === false
      ? null
      : (read.data?.ambiguous_ci_runners ?? null);
  const health = useMemo(
    () =>
      deriveComputersHealth({
        rows,
        loaded,
        issue: read.issue,
        unattributed: unattributed === null ? null : unattributed.length,
        ambiguous: ambiguous === null ? null : ambiguous.length,
      }),
    [rows, loaded, read.issue, unattributed, ambiguous]
  );

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-computers-page"
      data-ui-bridge-id="coord-computers-page"
    >
      <HealthStrip
        data-testid="coord-computers-health"
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
      />

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={read.refresh}
          label="Refresh computers"
          title={`Re-reads every computer from coord now; the page also refreshes itself every ${COMPUTERS_POLL_MS / 1000} s`}
          data-testid="coord-computers-refresh"
        />
        <p className="text-xs text-muted-foreground m-0">
          A computer is stale when its last report is older than 15 min, and its
          figures then read as last known, not current.
        </p>
      </div>

      {read.issue && (
        <ReadIssueBanner
          issue={read.issue}
          retained={loaded}
          testId="coord-computers-unknown-banner"
        />
      )}

      <section className="space-y-2" data-testid="coord-computers-list-section">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          Computers
        </h2>
        <RecordList
          items={rows}
          itemKey={(r) => r.computer.computerId}
          loaded={loaded || read.issue !== null}
          expandedKey={expandedKey}
          onExpandedKeyChange={setExpandedKey}
          empty={
            read.issue ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-computers-list-unknown"
              >
                No computer list from coord — which computers exist is unknown,
                not none.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-computers-list-empty"
              >
                Coord answered with no computers. A runner that predates
                computer reporting sends none, so this is no report — not a
                measured empty fleet.
              </p>
            )
          }
          renderRow={(row, ctx) => (
            <ComputerRow
              row={row}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              fetchedAtMs={read.fetchedAtMs}
              nowMs={nowMs}
            />
          )}
        />
      </section>

      <section
        className="space-y-2"
        data-testid="coord-computers-unattributed-section"
      >
        <h2 className="text-sm font-medium">Unattributed CI runners</h2>
        <p className="text-xs text-muted-foreground m-0">
          Runners GitHub&apos;s registrar knows about that no reporting computer
          claims. They are listed rather than dropped: nothing says which box
          they run on.
        </p>
        {loaded ? (
          <UnattributedRunners
            runners={unattributed}
            retained={read.issue !== null}
          />
        ) : (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-computers-unattributed-unknown"
          >
            Not read yet — unknown.
          </p>
        )}
      </section>

      <section
        className="space-y-2"
        data-testid="coord-computers-ambiguous-section"
      >
        <h2 className="text-sm font-medium">Ambiguous CI runners</h2>
        <p className="text-xs text-muted-foreground m-0">
          Runners two or more of your computers claim — a cloned image or a
          moved runner. Coord attributes them to none of them rather than
          letting the last report win.
        </p>
        {loaded ? (
          <AmbiguousRunners
            runners={ambiguous}
            computers={rows.map((r) => r.computer)}
            retained={read.issue !== null}
          />
        ) : (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="coord-computers-ambiguous-unknown"
          >
            Not read yet — unknown.
          </p>
        )}
      </section>
    </div>
  );
}
