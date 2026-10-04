"use client";

/**
 * /admin/coord/ci — Dev Ops ▸ CI: is CI healthy right now, and if not, where
 * is it stuck and why?
 *
 * Plan `2026-10-04-ci-dashboard-in-the-dev-ops-console` Phase 4 (D1: a leaf
 * of its own, because the Overview is the MACHINE axis and the pipeline page
 * is the PR axis — this page owns the POOL axis and the per-repo outcome
 * class, which no other view owned). Top to bottom:
 *
 *  1. **Health strip** (R1) — derived from the reads already on the page,
 *     never a second fetch (`deriveCiHealth`). It is never green while any
 *     pool is not measured, any pool's `required` is unknown, or either read
 *     failed or never landed: UNKNOWN renders UNKNOWN.
 *  2. **Pools** — one row per runner label set, expanding in place (R5) to
 *     each repo that uses it and its open alerts.
 *  3. **Repos** — main verdict, PR checks, candidate-CI p90, and the 24 h
 *     outcome split, content and infra-shaped ALWAYS separate, hosted always
 *     `–`. Train blockers are NOT rebuilt: each row links to the pipeline
 *     Train tab, which owns that axis (D2).
 *  4. **Machines link line** — per-machine occupancy stays on the Overview.
 *
 * ## Reads (one poll per route)
 *
 * - `/ci/overview` every 120 s (the queue-wait watcher's tick), owned by the
 *   PAGE: the strip is derived from it, so it cannot live inside a panel that
 *   can be closed (R7: "if anything else depended on its polling, hoist the
 *   fetch to the page").
 * - `/ci-status` over the existing `useCiStatusStream` WS (REST seed +
 *   fallback poll), also page-level for the same reason.
 * - `/pr-merge/merge-economics` every 60 s, owned by the Repos panel's CHILD,
 *   so a closed Repos panel polls nothing; only its p90 column reads it.
 *
 * Every figure is a `CellText`: a number only on a measured row, otherwise an
 * amber `–` whose title says why (D4, R6, the `LaneTable` per-field pattern).
 * Every number has a freshness stamp beside it (`ci-freshness-*`).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  CollapsiblePanel,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  absoluteTime,
  relativeTime,
  rowAccentProps,
} from "@/components/console";
import { useCiStatusStream } from "@/components/operations/useCiStatusStream";
import type { RepoCiRow } from "@/components/operations/types";
import {
  CI_OVERVIEW_POLL_MS,
  CI_POOL_PALETTE,
  CI_REPO_PALETTE,
  DASH,
  buildRepoRows,
  deriveCiHealth,
  poolGroupCells,
  poolLabel,
  poolMemberCells,
  stripLevel,
  type CellReading,
  type CiOverviewWire,
  type PoolGroup,
  type RepoRowModel,
} from "./_lib/ciDashboardStatus";
import { useCiEconomics, useCiOverview } from "./_lib/useCiReads";

/** A figure that may refuse to answer: amber `–` with the reason as its title. */
function CellText({
  reading,
  label,
  "data-testid": testId,
}: {
  reading: CellReading;
  label?: string;
  "data-testid"?: string;
}) {
  if (reading.known) {
    return (
      <span className="tabular-nums" data-testid={testId} data-known="true">
        {label ? <span className="text-muted-foreground">{label} </span> : null}
        {reading.text}
      </span>
    );
  }
  return (
    <span
      className="tabular-nums"
      title={reading.reason ?? undefined}
      data-testid={testId}
      data-known="false"
    >
      {label ? <span className="text-muted-foreground">{label} </span> : null}
      <span className="text-amber-300">{DASH}</span>
    </span>
  );
}

/** A freshness stamp: when the fact beside it was observed, or "unknown". */
function Freshness({
  at,
  verb,
  testId,
}: {
  at: string | null | undefined;
  verb: string;
  testId: string;
}) {
  return (
    <span data-testid={testId} className="shrink-0">
      <RowTime
        at={at ?? null}
        verb={verb}
        absent={{
          label: "freshness unknown",
          title: `${verb}: coord sent no timestamp for this figure, so how current it is is unknown`,
        }}
      />
    </span>
  );
}

function requiredText(required: boolean | null): string {
  if (required === true) return "required";
  if (required === false) return "not required";
  return "required: unknown";
}

function PoolRow({
  group,
  expanded,
  onToggle,
}: {
  group: PoolGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cells = poolGroupCells(group);
  const { status } = group;
  return (
    <RecordRow
      data-testid={`ci-pool-row-${group.pool}`}
      rowKey={group.pool}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span className="font-mono text-[11px]" title={poolLabel(group.pool)}>
          {poolLabel(group.pool)}
        </span>
      }
      label={
        <span className="inline-flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {group.members.length} repo{group.members.length === 1 ? "" : "s"}
          </span>
          <CellText reading={cells.eligible} label="eligible" />
          <CellText reading={cells.registered} label="registered" />
          <CellText reading={cells.drained} label="drained" />
          <CellText reading={cells.queued} label="queued" />
          <CellText reading={cells.oldest} label="oldest" />
          <CellText reading={cells.p90} label="p90 wait" />
        </span>
      }
      status={
        <span data-testid="ci-pool-status" data-status={status.kind}>
          <StatusBadge status={status} palette={CI_POOL_PALETTE} />
        </span>
      }
      reason={status.reason}
      reasonTestId="ci-pool-reason"
      time={
        <Freshness
          at={group.observedAt}
          verb="Observed"
          testId={`ci-freshness-pool-${group.pool}`}
        />
      }
    >
      <RecordDetail
        data-testid="ci-pool-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">{status.reason}</p>
        }
        problems={
          <div className="space-y-2">
            <ul
              className="space-y-1 m-0 p-0 list-none"
              data-testid="ci-pool-members"
            >
              {group.entries.map(({ member: m, status: s }) => {
                const c = poolMemberCells(m);
                return (
                  <li
                    key={m.repo}
                    {...rowAccentProps(
                      s,
                      "flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 text-xs"
                    )}
                    data-testid={`ci-pool-member-${m.repo}`}
                  >
                    <span className="font-mono text-[11px]">{m.repo}</span>
                    <StatusBadge status={s} palette={CI_POOL_PALETTE} />
                    <CellText reading={c.eligible} label="eligible" />
                    <CellText reading={c.registered} label="registered" />
                    <CellText reading={c.drained} label="drained" />
                    <CellText reading={c.queued} label="queued" />
                    <CellText reading={c.oldest} label="oldest" />
                    <CellText reading={c.p90} label="p90 wait" />
                    <span
                      className="text-muted-foreground"
                      title={m.required_note ?? undefined}
                    >
                      {requiredText(m.required)}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-2">
                      <Freshness
                        at={m.observed_at}
                        verb="Queue observed"
                        testId={`ci-freshness-pool-member-${m.repo}`}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
            {group.openAlerts.length > 0 ? (
              <ul
                className="space-y-1 m-0 p-0 list-none"
                data-testid="ci-pool-alerts"
              >
                {group.openAlerts.map((a) => (
                  <li
                    key={`${a.repo}:${a.alert_id}`}
                    className="text-xs"
                    data-testid={`ci-pool-alert-${a.alert_id}`}
                  >
                    <span className="font-mono text-[11px]">{a.kind}</span>{" "}
                    <span className="text-muted-foreground">({a.repo})</span> —{" "}
                    <span title="The alert's numbers as of when it FIRED — not the pool's current reading">
                      at fire time: {a.summary}
                    </span>{" "}
                    <span
                      className="text-muted-foreground"
                      title={absoluteTime(a.opened_at)}
                    >
                      fired {relativeTime(a.opened_at)}
                    </span>
                    {" · "}
                    <span
                      className="text-muted-foreground"
                      title={absoluteTime(a.last_seen_at ?? null)}
                      data-testid={`ci-freshness-alert-${a.alert_id}`}
                    >
                      last re-confirmed{" "}
                      {relativeTime(a.last_seen_at ?? null, {
                        absent: "never",
                      })}
                    </span>
                    {a.occurrences != null ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {a.occurrences} occurrence
                        {a.occurrences === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {a.current_state_note ? (
                      <span className="text-amber-200">
                        {" "}
                        — {a.current_state_note}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="text-xs text-muted-foreground m-0"
                data-testid="ci-pool-alerts-none"
              >
                No open queue-stall or pool alert for this pool.
              </p>
            )}
            <p className="text-xs text-muted-foreground m-0">
              Counts cover repo-registered runners only; organisation-level
              runners are not counted, so an eligible figure can read low.
              Registered beside eligible is the label-eligible registrations;
              drained runners are counted beside, not subtracted.
            </p>
          </div>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            pool: {group.pool}
            {group.members
              .map(
                (m) =>
                  ` · ${m.repo} state=${m.state} poll_ok=${String(m.poll_ok)} poll_complete=${String(m.poll_complete)} stale_after_secs=${m.stale_after_secs ?? "null"} eligibility=${m.eligibility_state ?? "null"}`
              )
              .join("")}
          </p>
        }
      />
    </RecordRow>
  );
}

function RepoRow({
  row,
  expanded,
  onToggle,
  economicsAsOf,
  overviewAsOf,
}: {
  row: RepoRowModel;
  expanded: boolean;
  onToggle: () => void;
  economicsAsOf: string | null;
  overviewAsOf: string | null;
}) {
  const { status, outcomes } = row;
  return (
    <RecordRow
      data-testid={`ci-repo-row-${row.repo}`}
      rowKey={row.repo}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={
        <span className="font-mono text-[11px]" title={row.repo}>
          {row.repo}
        </span>
      }
      label={
        <span className="inline-flex items-center gap-3 text-xs">
          <CellText reading={row.mainVerdict} label="main" />
          <CellText reading={row.prChecks} label="PRs" />
          <CellText reading={row.candidateP90} label="cand. p90" />
          <CellText reading={outcomes.content_fail} label="content fail" />
          <CellText reading={outcomes.infra_shaped} label="infra" />
          <CellText reading={outcomes.hosted} label="hosted" />
        </span>
      }
      status={
        <span data-testid="ci-repo-status" data-status={status.kind}>
          <StatusBadge status={status} palette={CI_REPO_PALETTE} />
        </span>
      }
      reason={status.reason}
      reasonTestId="ci-repo-reason"
      time={
        <Freshness
          at={row.mainObservedAt}
          verb="Main verdict observed"
          testId={`ci-freshness-main-${row.repo}`}
        />
      }
    >
      <RecordDetail
        data-testid="ci-repo-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">{status.reason}</p>
        }
        problems={
          <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-xs m-0">
            <dt className="text-muted-foreground">Main verdict</dt>
            <dd className="m-0">
              <CellText reading={row.mainVerdict} />
            </dd>
            <dd className="m-0">
              <Freshness
                at={row.mainObservedAt}
                verb="Main verdict observed"
                testId={`ci-freshness-main-detail-${row.repo}`}
              />
            </dd>
            <dt className="text-muted-foreground">Open-PR checks</dt>
            <dd className="m-0">
              <CellText reading={row.prChecks} />
            </dd>
            <dd className="m-0">
              <Freshness
                at={row.prChecksObservedAt}
                verb="PR checks observed"
                testId={`ci-freshness-prchecks-${row.repo}`}
              />
            </dd>
            <dt className="text-muted-foreground">Candidate CI p90</dt>
            <dd className="m-0">
              <CellText reading={row.candidateP90} />
            </dd>
            <dd className="m-0">
              <Freshness
                at={economicsAsOf}
                verb="Merge economics computed"
                testId={`ci-freshness-economics-${row.repo}`}
              />
            </dd>
            <dt className="text-muted-foreground">
              Job outcomes{row.windowHours ? ` (${row.windowHours} h)` : ""}
            </dt>
            <dd className="m-0 inline-flex flex-wrap gap-3">
              <CellText reading={outcomes.pass} label="pass" />
              <CellText reading={outcomes.content_fail} label="content fail" />
              <CellText reading={outcomes.infra_shaped} label="infra-shaped" />
              <CellText reading={outcomes.neutral} label="neutral" />
              <CellText reading={outcomes.unknown} label="unclassified" />
              <CellText reading={outcomes.hosted} label="hosted" />
            </dd>
            <dd className="m-0">
              <Freshness
                at={overviewAsOf}
                verb="Outcomes read"
                testId={`ci-freshness-outcomes-${row.repo}`}
              />
            </dd>
          </dl>
        }
        actions={
          <Link
            href={row.trainHref}
            className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
            data-testid={`ci-repo-train-link-${row.repo}`}
          >
            Train blockers and PR detail on the pipeline Train tab{" "}
            <ExternalLink className="h-3 w-3" />
          </Link>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            repo: {row.repo} · status: {status.kind} · outcomes_state:{" "}
            {row.outcomesState}
            {row.ci?.main_head_sha
              ? ` · main_head_sha: ${row.ci.main_head_sha}`
              : ""}
          </p>
        }
      />
    </RecordRow>
  );
}

/** The Repos panel's body — it owns the economics poll, so a closed panel polls nothing. */
function ReposSection({
  overview,
  overviewLoaded,
  ciRows,
  ciSeeded,
}: {
  overview: CiOverviewWire | null;
  overviewLoaded: boolean;
  ciRows: RepoCiRow[];
  ciSeeded: boolean;
}) {
  const economics = useCiEconomics();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const rows = useMemo(
    () => buildRepoRows(overview, ciRows, economics),
    [overview, ciRows, economics]
  );
  return (
    <RecordList
      items={rows}
      itemKey={(r) => r.repo}
      loaded={overviewLoaded || ciSeeded}
      expandedKey={expandedKey}
      onExpandedKeyChange={setExpandedKey}
      empty={
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="ci-repos-empty"
        >
          {overviewLoaded && ciSeeded
            ? `Coord answered with no repos for this tenant${overview?.note ? ` (${overview.note})` : ""}.`
            : "No repo list from coord yet — which repos exist is unknown, not none."}
        </p>
      }
      renderRow={(row, ctx) => (
        <RepoRow
          row={row}
          expanded={ctx.expanded}
          onToggle={ctx.onToggle}
          economicsAsOf={economics.asOf}
          overviewAsOf={overview?.as_of ?? null}
        />
      )}
    />
  );
}

export default function CoordCiPage() {
  const overview = useCiOverview();
  const ciStatus = useCiStatusStream();
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  // The page's clock: the overview read ages by TIME, and the coord that went
  // quiet is exactly the one that sends nothing to re-render the page.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const ciRows = useMemo(
    () => Array.from(ciStatus.byRepo.values()),
    [ciStatus.byRepo]
  );
  const health = useMemo(
    () =>
      deriveCiHealth(
        {
          data: overview.data,
          failed: overview.failed,
          failureText: overview.failureText,
        },
        { rows: ciRows, seeded: ciStatus.seeded, error: ciStatus.error },
        nowMs
      ),
    [
      overview.data,
      overview.failed,
      overview.failureText,
      ciRows,
      ciStatus.seeded,
      ciStatus.error,
      nowMs,
    ]
  );
  const stuckPools = health.pools.filter(
    (g) => g.status.attention === "author"
  ).length;
  const unmeasuredPools = health.pools.filter(
    (g) => g.state !== "measured"
  ).length;
  const reposAttention = ciRows.filter((r) => r.main_verdict === "red").length;
  // The Repos panel's collapsed-header count: the union of both reads' repos,
  // or a dash while neither has landed (never a 0 for "not read").
  const repoCount = useMemo(() => {
    if (!ciStatus.seeded && overview.data === null) return null;
    const keys = new Set(ciRows.map((r) => r.repo.toLowerCase()));
    for (const r of overview.data?.repos ?? []) keys.add(r.repo.toLowerCase());
    return keys.size;
  }, [ciStatus.seeded, ciRows, overview.data]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="ci-page"
      data-ui-bridge-id="ci-page"
      data-ci-health={health.level}
    >
      <HealthStrip
        data-testid="ci-health-strip"
        level={stripLevel(health.level)}
        headline={health.headline}
        detail={health.detail ?? undefined}
        badges={health.badges}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <RefreshButton
          onRefresh={overview.refresh}
          label="Refresh CI overview"
          title={`Re-reads pool and outcome state from coord now; the page also refreshes itself every ${CI_OVERVIEW_POLL_MS / 1000} s`}
          data-testid="ci-refresh"
        />
        <span>Overview read</span>
        <Freshness
          at={overview.data?.as_of}
          verb="Overview composed"
          testId="ci-freshness-overview"
        />
        <span>· CI status read</span>
        <Freshness
          at={ciStatus.asOf}
          verb="CI status composed"
          testId="ci-freshness-ci-status"
        />
        {overview.data?.coverage_note ? (
          <span data-testid="ci-coverage-note">
            · {overview.data.coverage_note}
          </span>
        ) : null}
      </div>

      {overview.failed ? (
        <p
          className="text-sm text-amber-200 m-0"
          role="status"
          data-testid="ci-overview-unknown-banner"
        >
          {overview.hasRead
            ? `The last CI overview refresh failed (${overview.failureText}). The rows below are the last good read, labelled with its time — not current.`
            : `The CI overview could not be read (${overview.failureText}). Pool state and job outcomes are UNKNOWN — not empty.`}
        </p>
      ) : null}

      <CollapsiblePanel
        title="Pools"
        defaultOpen
        storageKey="coord-ci-pools-open"
        data-testid="ci-pools-panel"
        summary={
          <span className="inline-flex items-center gap-2 text-xs font-mono">
            <span data-testid="ci-pools-summary-count">
              {overview.data ? health.pools.length : DASH} pools
            </span>
            {stuckPools > 0 ? (
              <span className="text-red-200">stuck {stuckPools}</span>
            ) : null}
            {unmeasuredPools > 0 ? (
              <span className="text-amber-200">
                not measured {unmeasuredPools}
              </span>
            ) : null}
          </span>
        }
      >
        <RecordList
          items={health.pools}
          itemKey={(g) => g.pool}
          loaded={overview.data !== null || overview.failed}
          expandedKey={expandedPool}
          onExpandedKeyChange={setExpandedPool}
          empty={
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="ci-pools-empty"
            >
              {overview.data === null
                ? "No pool list from coord — which pools exist is unknown, not none."
                : `Coord has no pool observations for this tenant${overview.data.note ? ` (${overview.data.note})` : ""} — no measurement, not an idle fleet.`}
            </p>
          }
          renderRow={(group, ctx) => (
            <PoolRow
              group={group}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Repos"
        defaultOpen
        storageKey="coord-ci-repos-open"
        data-testid="ci-repos-panel"
        summary={
          <span className="inline-flex items-center gap-2 text-xs font-mono">
            <span data-testid="ci-repos-summary-count">
              {repoCount === null ? DASH : repoCount} repos
            </span>
            {reposAttention > 0 ? (
              <span className="text-red-200">main red {reposAttention}</span>
            ) : null}
          </span>
        }
      >
        <ReposSection
          overview={overview.data}
          overviewLoaded={overview.data !== null}
          ciRows={ciRows}
          ciSeeded={ciStatus.seeded}
        />
      </CollapsiblePanel>

      <p
        className="text-xs text-muted-foreground m-0"
        data-testid="ci-machines-link-line"
      >
        Per-machine CI occupancy, capacity and the CI-node settings live on{" "}
        <Link
          href="/admin/coord/devops"
          className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:no-underline"
          data-testid="ci-machines-link"
        >
          Dev Ops → Overview
          <ExternalLink className="h-3 w-3" />
        </Link>
        .
      </p>
    </div>
  );
}
