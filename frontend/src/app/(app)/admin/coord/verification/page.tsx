"use client";

/**
 * /admin/coord/verification — the drill-down behind the overview's
 * "Can I trust 'done'?" tile.
 *
 * Plan `2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously`,
 * Phase 5. Renders coord's whole `GET /coord/verification/metrics` object:
 * trust calibration and independent-verification coverage over one population
 * (`population_query_id`), their unknowns by reason, the pre-land review
 * record BESIDE coverage (it is author-written, so it is never added into the
 * independent number), the sampling posture, the checker lane, and the
 * 12-week series with throughput and per-week `n`.
 *
 * ## Console style
 *
 * `<HealthStrip>` opens (R1), derived from the same read — green only when
 * coord looked, something was verified and the checker is keeping up; every
 * other state is amber (R3's "waiting, or we do not know"), never red. Page
 * chrome is the layout's one line (R9). The raw object is behind a
 * `<CollapsiblePanel>` (R7). Every derivation lives in
 * `components/admin/coord/verificationMetrics.ts` with its test (R8).
 *
 * A failed or degraded read renders "could not look" with the reason and the
 * last good stamp. Numbers from an earlier read are never replayed.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  CollapsiblePanel,
  HealthStrip,
  RefreshButton,
  StatCluster,
  absoluteTime,
  relativeTime,
  type Stat,
} from "@/components/console";
import { useTenant } from "@/contexts/tenant-context";
import { useVerificationMetrics } from "@/components/admin/coord/useVerificationMetrics";
import {
  REFUTED_FINDING_TOPIC,
  ageFromSecs,
  bpPct,
  deriveTrustView,
  deriveVerificationHealth,
  findingHref,
  interval,
  pct,
  ratePct,
  refutedUnitsInWindow,
  unverifiableTotal,
  type PopulatedMetrics,
  type SeriesWeek,
  type VerificationLane,
} from "@/components/admin/coord/verificationMetrics";

const WINDOWS = ["7d", "28d", "84d"] as const;
type WindowId = (typeof WINDOWS)[number];

function Stamp({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-muted-foreground">never</span>;
  return (
    <time dateTime={iso} title={absoluteTime(iso)}>
      {relativeTime(iso)}
    </time>
  );
}

function KV({
  k,
  children,
  id,
}: {
  k: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex gap-3 py-1 text-sm" data-testid={id}>
      <dt className="w-64 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function calibrationCell(c: SeriesWeek["trust_calibration"]): string {
  if (c.value == null) return "–";
  const iv = interval(c);
  return `${ratePct(c.value, c)}${iv ? ` ${iv}` : ""}`;
}

function SeriesTable({ series }: { series: SeriesWeek[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="coord-verification-series">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-4 font-normal">Week starting</th>
            <th className="py-1.5 pr-4 font-normal">Landed</th>
            <th className="py-1.5 pr-4 font-normal">Held up (95% CI)</th>
            <th className="py-1.5 pr-4 font-normal">n</th>
            <th className="py-1.5 pr-4 font-normal">Checked independently</th>
          </tr>
        </thead>
        <tbody>
          {series.map((w) => (
            <tr
              key={w.week_start}
              className="border-b border-border/50"
              data-testid="coord-verification-series-week"
            >
              <td className="py-1.5 pr-4 font-mono text-xs">
                {w.week_start.slice(0, 10)}
              </td>
              <td className="py-1.5 pr-4 tabular-nums">{w.throughput}</td>
              <td className="py-1.5 pr-4 tabular-nums">
                {calibrationCell(w.trust_calibration)}
              </td>
              <td
                className={`py-1.5 pr-4 tabular-nums ${w.n === 0 ? "text-amber-700 dark:text-amber-300" : ""}`}
                title={
                  w.n === 0
                    ? "No verification this week — a week the checker did not cover."
                    : undefined
                }
              >
                {w.n}
              </td>
              <td className="py-1.5 pr-4 tabular-nums">
                {w.independent_verification_coverage.value == null
                  ? "–"
                  : `${pct(w.independent_verification_coverage.value)} of ${w.independent_verification_coverage.population}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LaneBlock({ lane }: { lane: VerificationLane }) {
  return (
    <dl data-testid="coord-verification-lane">
      <KV k="Last verdict">
        <Stamp iso={lane.last_verdict_at} />
      </KV>
      <KV k="Last cycle">
        {lane.last_cycle_outcome}
        {lane.last_cycle_at && (
          <>
            {" "}
            (<Stamp iso={lane.last_cycle_at} />)
          </>
        )}
        {lane.last_cycle_reason && (
          <span className="text-muted-foreground">
            {" "}
            — {lane.last_cycle_reason}
          </span>
        )}
      </KV>
      <KV k="Canary">
        {lane.canary}
        {lane.canary_at && (
          <>
            {" "}
            (<Stamp iso={lane.canary_at} />)
          </>
        )}
      </KV>
      <KV k="Installed">
        {lane.installed === true
          ? "yes"
          : lane.installed === false
            ? "no"
            : "unknown"}
        <span className="text-muted-foreground"> — {lane.installed_basis}</span>
      </KV>
      {lane.journal_finding_id && (
        <KV k="Journal head">
          <Link
            href={findingHref(lane.journal_finding_id)}
            className="font-mono text-xs text-primary underline-offset-4 hover:underline"
          >
            {lane.journal_finding_id}
          </Link>
        </KV>
      )}
    </dl>
  );
}

function PopulatedBody({ m }: { m: PopulatedMetrics }) {
  const tc = m.trust_calibration;
  const cov = m.independent_verification_coverage;
  const u = m.unknowns;
  const stats: Stat[] = [
    { key: "landed", label: "landed", value: m.population },
    {
      key: "held",
      label: "held up",
      value: tc.value == null ? null : ratePct(tc.value, tc),
      title: tc.reason ?? undefined,
    },
    { key: "n", label: "n", value: tc.n },
    { key: "survived", label: "survived", value: tc.survived, tone: "success" },
    {
      key: "refuted",
      label: "refuted",
      value: tc.refuted,
      tone: tc.refuted > 0 ? "warning" : "default",
    },
    {
      key: "coverage",
      label: "checked",
      value: cov.value == null ? null : pct(cov.value),
      title: cov.reason ?? undefined,
    },
    {
      key: "unverifiable",
      label: "unverifiable",
      value: unverifiableTotal(u),
      tone: "muted",
    },
  ];
  const reasons = Object.entries(u.unverifiable_by_reason ?? {}).sort(
    (a, b) => b[1] - a[1]
  );
  return (
    <>
      <StatCluster stats={stats} data-testid="coord-verification-stats" />

      <section
        className="space-y-1"
        data-testid="coord-verification-calibration"
      >
        <h2 className="text-sm font-medium">Trust calibration</h2>
        <dl>
          <KV k="Held up when independently checked">
            {tc.value == null
              ? `unknown — ${tc.reason ?? "no verdicts in window"}`
              : `${ratePct(tc.value, tc)} ${interval(tc) ?? ""} — ${tc.survived} survived, ${tc.refuted} refuted, n=${tc.n} of ${tc.population}`}
          </KV>
          <KV k="Method">{tc.method}</KV>
          {tc.counts && <KV k="Counts">{tc.counts}</KV>}
        </dl>
      </section>

      <section className="space-y-1" data-testid="coord-verification-coverage">
        <h2 className="text-sm font-medium">
          Independent verification coverage
        </h2>
        <dl>
          <KV k="Checked by someone other than the author">
            {cov.value == null
              ? `unknown — ${cov.reason ?? "no population"}`
              : `${pct(cov.value)} — ${cov.verified_disjoint} of ${cov.population} landed units`}
          </KV>
        </dl>
      </section>

      <section className="space-y-1" data-testid="coord-verification-pre-land">
        <h2 className="text-sm font-medium">
          Pre-land review{" "}
          <span className="font-normal text-muted-foreground">
            — reported beside coverage, never counted in it
          </span>
        </h2>
        <dl>
          <KV k="Every landed head carried a reviewed-head record">
            {m.pre_land_review.units_with_reviewed_head_for_landed_sha} of{" "}
            {m.pre_land_review.population}
          </KV>
          <KV k="Why it is separate">{m.pre_land_review.note}</KV>
        </dl>
      </section>

      <section className="space-y-1" data-testid="coord-verification-unknowns">
        <h2 className="text-sm font-medium">Unknowns</h2>
        <dl>
          <KV k="Unverifiable, by reason">
            {reasons.length === 0
              ? "none"
              : reasons.map(([r, n]) => `${r}: ${n}`).join(" · ")}
          </KV>
          <KV k="Author unknown (independence unproven)">
            {u.independence_unproven}
          </KV>
          <KV k="Selected, not yet verified">
            {u.selected_not_yet_verified == null
              ? `unknown — ${u.selected_not_yet_verified_reason ?? "no reason given"}`
              : u.selected_not_yet_verified}
          </KV>
          <KV k="Oldest waiting">
            {ageFromSecs(u.oldest_unverified_age_secs)}
          </KV>
          <KV k="Claims unreadable">
            {u.claims_unreadable.count} of {u.claims_unreadable.examined}{" "}
            examined
            {u.claims_unreadable.of != null &&
              ` (of ${u.claims_unreadable.of} pending`}
            {u.claims_unreadable.of != null &&
              (u.claims_unreadable.complete
                ? ", all examined)"
                : ", not all examined)")}
            {u.claims_unreadable.first.length > 0 && (
              <span className="block text-xs text-muted-foreground">
                {u.claims_unreadable.first.join("; ")}
              </span>
            )}
          </KV>
          <KV k="Refutations answered by a later landing (recheck)">
            {u.recheck_pending}
            {u.recheck_unreadable > 0 &&
              ` (${u.recheck_unreadable} unreadable)`}
          </KV>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Last {m.series.length} weeks{" "}
          <span className="font-normal text-muted-foreground">
            — landed and verified from the same population, per week
          </span>
        </h2>
        <SeriesTable series={m.series} />
      </section>
    </>
  );
}

export default function CoordVerificationPage() {
  const { activeTenantId, loading, error: tenantsError } = useTenant();
  const [windowId, setWindowId] = useState<WindowId>("28d");
  const { read, refuted, lastGood, reload } = useVerificationMetrics(
    activeTenantId,
    loading,
    windowId,
    tenantsError
  );
  const view = useMemo(() => deriveTrustView(read, lastGood), [read, lastGood]);
  const health = useMemo(() => deriveVerificationHealth(view), [view]);
  const metrics = read.status === "ok" ? read.metrics : null;
  const refutedUnits = useMemo(() => {
    if (refuted.status !== "ok" || !metrics) return null;
    return refutedUnitsInWindow(refuted.findings, metrics.window.from);
  }, [refuted, metrics]);

  return (
    <div className="p-3 sm:p-6 space-y-5" data-testid="coord-verification-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={
          metrics
            ? [
                { key: "window", label: `window ${metrics.window.days}d` },
                ...(metrics.degraded
                  ? [
                      {
                        key: "degraded",
                        label: "could not look",
                        tone: "attention" as const,
                      },
                    ]
                  : []),
              ]
            : []
        }
        data-testid="coord-verification-health"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {WINDOWS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={windowId === w ? "secondary" : "ghost"}
            aria-pressed={windowId === w}
            onClick={() => setWindowId(w)}
            data-testid={`coord-verification-window-${w}`}
          >
            {w}
          </Button>
        ))}
        <RefreshButton
          onRefresh={reload}
          label="Refresh verification metrics"
          title="Re-reads coord's verification metrics and the refutation findings now"
          data-testid="coord-verification-refresh"
        />
        {metrics && (
          <p className="text-xs text-muted-foreground">
            As of <Stamp iso={metrics.generated_at} /> · population{" "}
            <span className="font-mono">{metrics.population_query_id}</span>
          </p>
        )}
      </div>

      {view.state === "could_not_look" && (
        <p
          role="status"
          className="border-l-2 border-amber-500/60 pl-3 text-sm"
          data-testid="coord-verification-could-not-look"
        >
          Could not look — {view.reason} — last good{" "}
          {view.lastGood ? (
            <Stamp iso={view.lastGood} />
          ) : (
            "never, in this browser"
          )}
          . These are not zeros.
        </p>
      )}

      {metrics && !metrics.degraded && <PopulatedBody m={metrics} />}

      <section className="space-y-1" data-testid="coord-verification-refuted">
        <h2 className="text-sm font-medium">Refuted in this window</h2>
        {refuted.status === "loading" && (
          <p className="text-sm text-muted-foreground">Reading…</p>
        )}
        {refuted.status === "error" && (
          <p className="text-sm text-muted-foreground">
            Could not list refutations — {refuted.reason}. Not the same as none.
          </p>
        )}
        {refuted.status === "ok" &&
          refutedUnits !== null &&
          (refutedUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No refutation finding in this window.
            </p>
          ) : (
            <ul className="space-y-1">
              {refutedUnits.map((r) => (
                <li
                  key={r.findingId}
                  className="flex items-baseline gap-3 text-sm"
                >
                  <Link
                    href={findingHref(r.findingId)}
                    className="text-foreground underline decoration-destructive/60 underline-offset-4 hover:decoration-destructive"
                  >
                    {r.label}
                  </Link>
                  {r.slug && r.slug !== r.label && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.slug}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    <Stamp iso={r.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          ))}
        {refuted.status === "ok" && refutedUnits === null && (
          <p className="text-sm text-muted-foreground">
            Unknown — the window could not be read, so refutations cannot be
            placed in it.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Read from the findings store (topic{" "}
          <Link
            href={`/admin/coord/findings`}
            className="font-mono underline-offset-4 hover:underline"
          >
            {REFUTED_FINDING_TOPIC}
          </Link>
          ). A refutation a later &lsquo;survived&rsquo; verdict superseded is
          still listed here; the counts above use only standing verdicts.
        </p>
      </section>

      {metrics && (
        <>
          <section className="space-y-1">
            <h2 className="text-sm font-medium">Checker lane</h2>
            <LaneBlock lane={metrics.lane} />
          </section>

          <section
            className="space-y-1"
            data-testid="coord-verification-sampling"
          >
            <h2 className="text-sm font-medium">Sampling</h2>
            <dl>
              <KV k="Configured rate">
                {bpPct(metrics.sampling.configured_rate_bp)}
                <span className="text-muted-foreground">
                  {" "}
                  ({metrics.sampling.rate_source ?? "unknown"})
                </span>
              </KV>
              <KV k="Effective rate">
                {bpPct(metrics.sampling.effective_rate_bp)}
                {metrics.sampling.surge_reason && (
                  <span className="text-muted-foreground">
                    {" "}
                    — surge: {metrics.sampling.surge_reason}
                  </span>
                )}
              </KV>
              <KV k="Calibration floor">
                {bpPct(metrics.sampling.calibration_floor_bp)}
                <span className="text-muted-foreground">
                  {" "}
                  ({metrics.sampling.floor_source ?? "unknown"})
                </span>
              </KV>
            </dl>
          </section>

          <CollapsiblePanel
            title="Raw response"
            defaultOpen={false}
            data-testid="coord-verification-raw"
          >
            <pre className="max-h-96 overflow-auto text-[11px] leading-snug">
              {JSON.stringify(metrics, null, 2)}
            </pre>
          </CollapsiblePanel>
        </>
      )}
    </div>
  );
}
