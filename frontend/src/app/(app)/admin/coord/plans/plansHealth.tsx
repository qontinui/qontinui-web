"use client";

/**
 * The `/admin/coord/plans` health strip, derived.
 *
 * Split out of `page.tsx` because a Next.js App Router page module may export
 * NOTHING but its default and the framework's own reserved names — an extra
 * export is a `.next/types` TS2344, not a lint nit. Living beside the page
 * (the convention `planSort.ts` already set on this route) also makes the
 * absence-is-not-zero rule below unit-testable without rendering the page.
 *
 * **R1** — every count here comes from the rows the page ALREADY fetched.
 * There is no second request, and there cannot be: this module takes the list
 * as an argument.
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import { describePlanStatus } from "@/components/admin/coord/planStatus";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";

export interface PlansHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch.
 *
 * `loaded=false` is NOT "zero of everything": every count is `null`, which the
 * badge renders as `–`. A page that has not heard from coord yet must not
 * claim there are no blocked plans.
 */
export function derivePlansHealth(
  plans: CoordPlanRow[],
  loaded: boolean
): PlansHealth {
  const n = (v: number) => (loaded ? v : null);
  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the work-unit list arrives",
      badges: [
        { key: "total", label: <>plans –</>, tone: "muted" },
        { key: "blocked", label: <>blocked –</>, tone: "muted" },
      ],
    };
  }

  let blocked = 0;
  let active = 0;
  let shipped = 0;
  let unrecognised = 0;
  for (const p of plans) {
    const tag = describePlanStatus(p.status);
    if (tag.tone === "blocked") blocked += 1;
    else if (tag.tone === "active") active += 1;
    else if (tag.tone === "shipped") shipped += 1;
    if (!tag.recognised) unrecognised += 1;
  }

  const level: HealthStripLevel =
    blocked > 0 ? "red" : unrecognised > 0 ? "amber" : "green";
  const headline =
    blocked > 0
      ? `${blocked} plan${blocked === 1 ? "" : "s"} blocked on a human`
      : plans.length === 0
        ? "No work units in this window"
        : "No plan is blocked";
  const detail =
    unrecognised > 0
      ? `${unrecognised} carry a status this build has no label for — shown verbatim`
      : `${active} in progress, ${shipped} shipped`;

  return {
    level,
    headline,
    detail,
    badges: [
      { key: "total", label: <>plans {n(plans.length)}</>, tone: "muted" },
      {
        key: "blocked",
        label: <>blocked {n(blocked)}</>,
        tone: blocked > 0 ? "attention" : "muted",
        title: "work units whose status is blocked — nothing downstream clears these",
      },
      { key: "active", label: <>in progress {n(active)}</>, tone: "default" },
      { key: "shipped", label: <>shipped {n(shipped)}</>, tone: "muted" },
      ...(unrecognised > 0
        ? [
            {
              key: "unrecognised",
              label: <>unlabelled {n(unrecognised)}</>,
              tone: "default" as const,
              title:
                "work-unit status is opaque text in coord; these values are not in this build's display vocabulary",
            },
          ]
        : []),
    ],
  };
}
