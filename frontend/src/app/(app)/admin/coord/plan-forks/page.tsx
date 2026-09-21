"use client";

/**
 * /admin/coord/plan-forks — copies of one plan that do not agree.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4b.
 * The consumer for `GET /api/v1/plan-library/divergent`, which had none:
 * measured on `origin/main`, a `git grep` for the route name across
 * `frontend/**` matched only the two generated OpenAPI snapshots. An
 * unconsumed route is not neutral — it is a maintained surface with tests, an
 * OpenAPI entry and a contract, delivering nothing [policy:
 * `capability-ships-enabled`].
 *
 * ## Where an operator arrives from
 *
 * `/admin/coord/plans` renders a `coord-plan-divergent` marker on any stem
 * whose `variant_count > 1` — the route carries that count *precisely so a
 * divergent copy is visible rather than silently collapsed to the newest*.
 * That marker is now a link here. The nav carries it too, because a fork an
 * operator has not been sent to is still a fork.
 *
 * ## What this page does NOT do
 *
 * It does not propose a resolution. The parent plan is explicit: *"Declaring
 * an authority does not merge the divergent stems — they are genuinely
 * different documents and the disposition is a content judgement, so it stays
 * the operator's call."* So every variant is shown with its own provenance,
 * digest, status and version, and the page offers no "keep this one" button,
 * no winner, and no ordering that implies one. The only ordering is temporal
 * and it says so.
 *
 * The one machine-side reading it forwards is the route's own `resolvable` on
 * a KIND fork: exactly one locked kind means the scanner prefers that row by
 * itself. That is a statement about what the scanner will do, not about which
 * copy is right.
 *
 * ## Computed live, so an empty answer is a measurement
 *
 * The route recomputes on every read — there is no stored list — which is why
 * a clean read is reported as *measured now* and a failed one as UNKNOWN.
 * Caching a fork list into a document would be the same defect class as the
 * fork itself.
 *
 * ## Console style
 *
 * R9 (no page-level card — the coord layout owns the `<h1>`), R1 (a
 * `<HealthStrip>` off the response already fetched), R2/R5 (one group is one
 * `<RecordRow>`, its variants expand in place), R6 (`–`, never `0`, for an
 * unserved count), R8 (every reading is derived in `forkStatus.ts`).
 */

import { useCallback, useMemo, useState } from "react";
import { GitFork, Tags } from "lucide-react";
import {
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  StatusBadge,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import {
  useGuardedPoll,
  type ReadGuard,
} from "@/components/admin/coord/useGuardedPoll";
import { httpClient } from "@/services/service-factory";
import {
  FORK_PALETTE,
  VARIANT_ORDER_CAVEAT,
  VARIANT_STATUS_CLASS,
  deriveForkCensus,
  deriveForkHealth,
  describeContentFork,
  describeKindFork,
  orderVariants,
  shortDigest,
  variantOrigin,
  type DivergentGroup,
  type DivergentResponse,
  type DivergentVariant,
  type KindForkGroup,
} from "./forkStatus";

const ENDPOINT = "/api/v1/plan-library/divergent";
const POLL_INTERVAL_MS = 60_000;

function VariantTable({ variants }: { variants: DivergentVariant[] }) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-xs"
        data-testid="coord-fork-variants"
      >
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-normal pb-1 pr-3">source</th>
            <th className="font-normal pb-1 pr-3">kind</th>
            <th className="font-normal pb-1 pr-3">status</th>
            <th className="font-normal pb-1 pr-3">digest</th>
            <th className="font-normal pb-1 pr-3">v</th>
            <th className="font-normal pb-1">last touched</th>
          </tr>
        </thead>
        <tbody>
          {orderVariants(variants).map((variant) => (
            <tr
              key={variant.id}
              className="border-t border-border/60"
              data-testid="coord-fork-variant"
              data-kind-locked={variant.kind_locked ? "true" : "false"}
            >
              <td className="py-1 pr-3 font-mono text-[11px]">
                {variantOrigin(variant)}
              </td>
              <td className="py-1 pr-3 font-mono text-[11px]">
                {variant.kind}
                {variant.kind_locked && (
                  <span
                    className="ml-1 text-muted-foreground"
                    title="This copy's kind was set deliberately, so a heuristic re-scan may no longer move it."
                    data-testid="coord-fork-variant-locked"
                  >
                    (locked)
                  </span>
                )}
              </td>
              <td className="py-1 pr-3">
                <span
                  className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${VARIANT_STATUS_CLASS}`}
                >
                  {variant.status || "no status"}
                </span>
              </td>
              <td
                className="py-1 pr-3 font-mono text-[11px] text-muted-foreground"
                title={variant.content_sha256}
                data-testid="coord-fork-variant-digest"
              >
                {shortDigest(variant.content_sha256)}
              </td>
              <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                {variant.current_version}
              </td>
              <td
                className="py-1 text-muted-foreground"
                title={absoluteTime(variant.updated_at)}
              >
                {relativeTime(variant.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground mt-1">
        {VARIANT_ORDER_CAVEAT}
      </p>
    </div>
  );
}

function ContentForkRow({
  group,
  expanded,
  onToggle,
}: {
  group: DivergentGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = describeContentFork(group);
  const titles = [...new Set(group.variants.map((v) => v.title))];
  return (
    <RecordRow
      data-testid="coord-fork-content-row"
      rowKey={`${group.kind}:${group.slug}`}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={<GitFork className="h-3.5 w-3.5" aria-hidden="true" />}
      label={
        <span title={`${group.kind} / ${group.slug}`}>
          <span className="font-mono">{group.slug}</span>
          <span className="text-muted-foreground"> · {group.kind}</span>
        </span>
      }
      status={<StatusBadge status={status} palette={FORK_PALETTE} />}
      reason={status.reason}
      reasonTestId="coord-fork-content-reason"
    >
      <RecordDetail
        data-testid="coord-fork-content-detail"
        why={
          <div className="text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">Why: </span>
              <span className="text-foreground/90">{status.reason}</span>
            </div>
            {titles.length > 1 && (
              <div data-testid="coord-fork-title-disagreement">
                <span className="text-muted-foreground">
                  The copies do not even agree on a title:{" "}
                </span>
                {titles.join(" · ")}
              </div>
            )}
          </div>
        }
        problems={<VariantTable variants={group.variants} />}
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 space-y-0.5">
            <div>kind: {group.kind}</div>
            <div>slug: {group.slug}</div>
            <div>variant_count: {group.variant_count}</div>
          </div>
        }
      />
    </RecordRow>
  );
}

function KindForkRow({
  group,
  expanded,
  onToggle,
}: {
  group: KindForkGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = describeKindFork(group);
  return (
    <RecordRow
      data-testid="coord-fork-kind-row"
      rowKey={`${group.slug}:${group.source_repo ?? "no-repo"}`}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={<Tags className="h-3.5 w-3.5" aria-hidden="true" />}
      label={
        <span
          title={`${group.slug} in ${group.source_repo ?? "no source repo"}`}
        >
          <span className="font-mono">{group.slug}</span>
          <span className="text-muted-foreground">
            {" "}
            · {group.source_repo ?? "no source repo"}
          </span>
        </span>
      }
      status={
        <>
          <span
            data-testid="coord-fork-kind-verdict"
            data-fork-kind={status.kind}
            data-resolvable={group.resolvable ? "true" : "false"}
          >
            <StatusBadge status={status} palette={FORK_PALETTE} />
          </span>
          <span
            className="text-[11px] text-muted-foreground"
            data-testid="coord-fork-kinds"
          >
            {group.kinds.join(" vs ")}
          </span>
        </>
      }
      reason={status.reason}
      reasonTestId="coord-fork-kind-reason"
    >
      <RecordDetail
        data-testid="coord-fork-kind-detail"
        why={
          <div className="text-xs">
            <span className="text-muted-foreground">Why: </span>
            <span className="text-foreground/90">{status.reason}</span>
          </div>
        }
        problems={<VariantTable variants={group.variants} />}
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 space-y-0.5">
            <div>slug: {group.slug}</div>
            <div>source_repo: {group.source_repo ?? "null"}</div>
            <div>kinds: {group.kinds.join(", ")}</div>
            <div>resolvable: {String(group.resolvable)}</div>
          </div>
        }
      />
    </RecordRow>
  );
}

export default function CoordPlanForksPage() {
  const [data, setData] = useState<DivergentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guarded by `useGuardedPoll` — the same two counters and in-flight lock
   * every coord console list uses. This page has no window control, so it
   * asks one question for its whole life and only the second race is live
   * here: without the lock a refresh CLICK stacks on an in-flight poll, and
   * two overlapping reads of a LIVE-computed fork list can land out of order,
   * leaving the older census on screen.
   */
  const fetchData = useCallback(async (guard: ReadGuard) => {
    try {
      const body = await httpClient.get<DivergentResponse>(ENDPOINT);
      if (!guard.isNewest()) return;
      setData(body);
      setError(null);
    } catch (e) {
      if (!guard.isCurrentQuestion()) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const { refresh } = useGuardedPoll({
    read: fetchData,
    intervalMs: POLL_INTERVAL_MS,
  });

  const census = useMemo(
    () => (data === null ? null : deriveForkCensus(data)),
    [data]
  );
  const loaded = data !== null;
  const readFailed = error !== null;
  const health = useMemo(
    () => deriveForkHealth(census, loaded, readFailed),
    [census, loaded, readFailed]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-plan-forks-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-plan-forks-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={refresh}
          label="Refresh fork list"
          title={`Re-computes the fork list now; it also refreshes itself every ${POLL_INTERVAL_MS / 1000} s`}
          data-testid="coord-plan-forks-refresh"
        />
        <p className="text-xs text-muted-foreground">
          Computed live on every read — there is no stored fork list. This page
          presents the fork; which copy is the plan is a content judgement and
          stays yours.
        </p>
      </div>

      {error && (
        <p
          className="text-sm text-destructive"
          data-testid="coord-plan-forks-error"
        >
          Failed to load: {error}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Content forks{" "}
          <span
            className="text-muted-foreground font-normal"
            data-testid="coord-fork-content-total"
          >
            ({census?.contentTotal ?? "–"})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Same kind and slug, different content digests — one document captured
          from checkouts that drifted apart.
        </p>
        <RecordList
          items={census?.groups ?? []}
          itemKey={(g) => `${g.kind}:${g.slug}`}
          loaded={loaded || readFailed}
          skeletonRows={3}
          empty={
            readFailed && !loaded ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-content-unknown"
              >
                Could not read the fork list — whether any copy disagrees is
                unknown, not none.
              </p>
            ) : readFailed ? (
              // A failed refresh over a loaded window is STALE — and "as
              // measured by this read" is a claim about a measurement that
              // just failed.
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-content-stale"
              >
                No content fork at the last good read — it has not refreshed
                since, so whether any copy disagrees NOW is unknown.
              </p>
            ) : census?.groupsUnstated ? (
              // The list is optional on the wire, so an absent one is not an
              // empty one — and `total` may be a positive number right above
              // this sentence. "As measured by this read" would then be a
              // measurement claim about rows the read never carried.
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-content-unstated"
              >
                This response carried no groups list, so whether two copies of a
                plan disagree on content is unknown — not none.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-content-empty"
              >
                No two copies of one plan disagree on content, as measured by
                this read.
              </p>
            )
          }
          renderRow={(group, ctx) => (
            <ContentForkRow
              group={group}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Kind forks{" "}
          <span
            className="text-muted-foreground font-normal"
            data-testid="coord-fork-kind-total"
          >
            ({census?.kindForkTotal ?? "–"})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Same slug and source repo, different{" "}
          <span className="font-mono">kind</span>. A different failure from a
          content fork — grouping by (kind, slug) structurally cannot see one,
          which is why the route reports them separately.
        </p>
        <RecordList
          items={census?.kindForks ?? []}
          itemKey={(g) => `${g.slug}:${g.source_repo ?? "no-repo"}`}
          loaded={loaded || readFailed}
          skeletonRows={2}
          empty={
            readFailed && !loaded ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-kind-unknown"
              >
                Could not read the fork list — whether any slug is forked across
                kinds is unknown, not none.
              </p>
            ) : readFailed ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-kind-stale"
              >
                No kind fork at the last good read — it has not refreshed since,
                so whether any slug is forked NOW is unknown.
              </p>
            ) : census?.kindForksUnstated ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-kind-unstated"
              >
                This response carried no kind_forks list, so whether any slug is
                forked across kinds is unknown — not none. A kind_fork_total
                beside it counts rows this page never saw.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-fork-kind-empty"
              >
                No slug carries two kinds, as measured by this read.
              </p>
            )
          }
          renderRow={(group, ctx) => (
            <KindForkRow
              group={group}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
        />
      </section>
    </div>
  );
}
