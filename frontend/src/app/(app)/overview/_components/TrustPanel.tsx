"use client";

/**
 * "Can I trust 'done'?" — the Summary's second side-column tile, under
 * Progress. How much of what the project reports as landed held up when a
 * checker that did not write it looked, how much was looked at, and what
 * could not be.
 *
 * Plan `2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously`,
 * Phase 5. The model is `deriveTrustView` (`verificationMetrics.ts`); this
 * file renders it and does no arithmetic.
 *
 * Four states, each with its own words, and none of them a number it does
 * not have:
 *
 * - **populated** — throughput and calibration for the same window side by
 *   side, then calibration with its interval and `n`, coverage, the unknowns,
 *   the refuted units by plan title (each opening its finding);
 * - **no verifications yet** — never 0 % and never 100 %;
 * - **could not look** — coord said so (`degraded`) or did not answer: the
 *   reason and the last good stamp, never the last good numbers;
 * - **loading**.
 *
 * The checker's freshness line is on every state, because a tile that reads
 * well while the checker has stopped is the stale green this tile exists to
 * rule out. Nothing per-criterion, no diff and no file list here — that is
 * the drill-down's.
 */

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { absoluteTime, relativeTime } from "@/components/console";
import {
  findingHref,
  type LaneView,
  type RefutedUnit,
  type TrustView,
} from "@/components/admin/coord/verificationMetrics";
import { cn } from "@/lib/utils";

export const VERIFICATION_DRILLDOWN_HREF = "/admin/coord/verification";

export type RefutedList =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ok"; units: RefutedUnit[]; truncated: boolean };

function LaneLine({ lane }: { lane: LaneView }) {
  return (
    <p
      className={cn(
        "mt-4 flex items-start gap-2 text-xs leading-relaxed",
        lane.attention
          ? "text-amber-700 dark:text-amber-300"
          : "text-muted-foreground"
      )}
      data-ui-bridge-id="overview.summary.trust.lane"
      data-attention={lane.attention ? "waiting" : "none"}
    >
      {lane.attention && (
        // A shape as well as a hue: amber is "we do not know / waiting".
        <span aria-hidden className="mt-0.5">
          ◔
        </span>
      )}
      <span>{lane.line}</span>
    </p>
  );
}

function DetailsLink() {
  return (
    <p className="mt-3 text-sm">
      <Link
        href={VERIFICATION_DRILLDOWN_HREF}
        className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        data-ui-bridge-id="overview.summary.trust.details"
      >
        How this is measured, week by week
      </Link>
    </p>
  );
}

function RefutedSection({ count, list }: { count: number; list: RefutedList }) {
  return (
    <div className="mt-4" data-ui-bridge-id="overview.summary.trust.refuted">
      {list.status === "loading" && (
        <Skeleton className="h-4 w-40" aria-hidden />
      )}
      {list.status === "error" && (
        <p className="text-sm text-muted-foreground">
          {count > 0
            ? `${count} refuted in this window — the list couldn’t be read (${list.reason}). `
            : `Refutations couldn’t be listed (${list.reason}). `}
          <Link
            href={VERIFICATION_DRILLDOWN_HREF}
            className="text-primary underline-offset-4 hover:underline"
          >
            Open the details
          </Link>
        </p>
      )}
      {list.status === "ok" &&
        (list.units.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {count > 0
              ? `${count} refuted in this window; their findings aren’t in the store’s latest page.`
              : "Nothing refuted in this window."}
          </p>
        ) : (
          <>
            <h3 className="text-sm text-foreground">Refuted in this window</h3>
            <ul className="mt-1.5 space-y-1">
              {list.units.map((u) => (
                <li key={u.findingId} className="text-sm leading-snug">
                  <Link
                    href={findingHref(u.findingId)}
                    title={u.slug ?? undefined}
                    className="text-foreground underline decoration-destructive/60 underline-offset-4 hover:decoration-destructive"
                    data-ui-bridge-id={`overview.summary.trust.refuted.${u.findingId}`}
                  >
                    {u.label}
                  </Link>
                </li>
              ))}
            </ul>
            {list.truncated && (
              <p className="mt-1 text-xs text-muted-foreground">
                More refutations exist than one read returns.
              </p>
            )}
          </>
        ))}
    </div>
  );
}

export function TrustPanel({
  view,
  refuted,
}: {
  view: TrustView;
  refuted: RefutedList;
}) {
  if (view.state === "loading") {
    return (
      <div
        className="space-y-3"
        aria-hidden
        data-ui-bridge-id="overview.summary.trust.loading"
      >
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (view.state === "could_not_look") {
    return (
      <div
        data-ui-bridge-id="overview.summary.trust"
        data-state="could_not_look"
      >
        <p
          role="status"
          className="border-l-2 border-amber-500/60 pl-3 text-[15px] leading-relaxed text-foreground"
          data-ui-bridge-id="overview.summary.trust.could-not-look"
        >
          Could not look — {view.reason} — last good{" "}
          {view.lastGood ? (
            <time dateTime={view.lastGood} title={absoluteTime(view.lastGood)}>
              {relativeTime(view.lastGood)}
            </time>
          ) : (
            "never, in this browser"
          )}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          These are not zeros: nothing here is known until the read succeeds.
        </p>
        <LaneLine lane={view.lane} />
        <DetailsLink />
      </div>
    );
  }

  return (
    <div data-ui-bridge-id="overview.summary.trust" data-state={view.state}>
      <p
        className="font-[family-name:var(--font-overview-serif)] text-2xl leading-snug text-foreground"
        data-ui-bridge-id="overview.summary.trust.headline"
      >
        {view.throughputLine}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Last {view.windowDays} days, as of{" "}
        <time
          dateTime={view.generatedAt}
          title={absoluteTime(view.generatedAt)}
        >
          {relativeTime(view.generatedAt)}
        </time>
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        {view.state === "populated" ? (
          <div data-ui-bridge-id="overview.summary.trust.calibration">
            <dt className="text-muted-foreground">Held up when checked</dt>
            <dd className="text-foreground">{view.calibrationLine}</dd>
          </div>
        ) : (
          <div data-ui-bridge-id="overview.summary.trust.no-verifications">
            <dt className="text-muted-foreground">Held up when checked</dt>
            <dd className="text-foreground">
              Unknown — no verifications yet in this window, so there is no rate
              to show.
            </dd>
          </div>
        )}
        <div data-ui-bridge-id="overview.summary.trust.coverage">
          <dt className="text-muted-foreground">Checked independently</dt>
          <dd className="text-foreground">
            {view.coverageLine ?? "Unknown — nothing landed in this window"}
          </dd>
        </div>
        <div data-ui-bridge-id="overview.summary.trust.unknowns">
          <dt className="text-muted-foreground">Not known yet</dt>
          <dd className="text-foreground">{view.unknownsLine}</dd>
        </div>
      </dl>

      <RefutedSection count={view.refuted} list={refuted} />
      <LaneLine lane={view.lane} />
      <DetailsLink />
    </div>
  );
}
