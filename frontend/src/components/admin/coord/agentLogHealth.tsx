"use client";

/**
 * The `/admin/coord/agents/[agent_id]` health strip, derived.
 *
 * **R1** — every count here comes from the log rows the page ALREADY fetched.
 * There is no second request and there cannot be: this module takes the list
 * as an argument. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 3.
 *
 * It lives in `components/admin/coord/` rather than beside the page because a
 * Next.js App Router page module may export NOTHING but its default and the
 * framework's reserved names — an extra export there is a `.next/types`
 * TS2344, not a lint nit — and because the dynamic-segment directory
 * (`[agent_id]/`) is a worse home for a plain module than the component folder
 * `LogRow` already occupies.
 *
 * ## The one judgement in here, stated
 *
 * **An `error` row makes the strip RED.** That is R3's "someone must act now"
 * read literally for a log: an agent that logged an error is the one thing on
 * this page a human is expected to do something about, and this route exists
 * to be opened when an agent is misbehaving. `warn` is amber — it is the
 * "something may need watching" band, and nothing on the page clears it except
 * the agent moving on. Everything else is calm.
 *
 * The counts are over the FILTERED rows, not the raw window, because the
 * filtered set is what the operator is looking at; the strip's detail names
 * the window so the two numbers can never be confused.
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import { normalizeLevel } from "@/components/admin/coord/LevelBadge";
import type { AgentLogRow } from "@/components/admin/coord/LogRow";

export interface AgentLogHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

/**
 * The page's health, derived from the rows already on it (R1).
 *
 * `loaded=false` returns EARLY with badge labels that spell the dash
 * literally. `<HealthStrip>` renders `badge.label` verbatim, so a `null` label
 * renders NOTHING rather than `–`; R6's absence-is-not-zero rule is held here
 * by this early return, not by any null-coalescing further down. A page that
 * has not heard from coord yet must not claim this agent logged no errors.
 */
export function deriveAgentLogHealth(
  filtered: AgentLogRow[],
  total: number,
  loaded: boolean
): AgentLogHealth {
  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the log window arrives",
      badges: [
        { key: "rows", label: <>rows –</>, tone: "muted" },
        { key: "errors", label: <>errors –</>, tone: "muted" },
      ],
    };
  }

  let errors = 0;
  let warns = 0;
  for (const row of filtered) {
    // Through the SAME normaliser the badge and the level chips use — a bare
    // `toLowerCase()` reads `warning` as its own level and undercounts `warn`.
    const lvl = normalizeLevel(row.level);
    if (lvl === "error") errors += 1;
    else if (lvl === "warn") warns += 1;
  }

  const level: HealthStripLevel =
    errors > 0 ? "red" : warns > 0 ? "amber" : "green";
  const headline =
    errors > 0
      ? `${errors} error${errors === 1 ? "" : "s"} in this window`
      : filtered.length === 0
        ? "Nothing matches the current filters"
        : warns > 0
          ? `${warns} warning${warns === 1 ? "" : "s"}, no errors`
          : "No errors or warnings";
  const detail =
    total === filtered.length
      ? `${total} row${total === 1 ? "" : "s"} in the fetched window`
      : `${filtered.length} of ${total} rows shown — filters are active`;

  return {
    level,
    headline,
    detail,
    badges: [
      {
        key: "rows",
        // The FILTERED/TOTAL pair the deleted `<CardTitle>` carried as
        // `{filtered} / {total}`. Collapsing it to one number lost the fact
        // that a filter is hiding rows — which on a log page is the difference
        // between "this agent logged three things" and "you are looking at
        // three of four hundred". Both numbers are already here; only the
        // second was being dropped.
        label:
          total === filtered.length ? (
            <>rows {filtered.length}</>
          ) : (
            <>
              rows {filtered.length}/{total}
            </>
          ),
        tone: "muted",
        title:
          total === filtered.length
            ? undefined
            : `${filtered.length} of ${total} rows in the fetched window match the current filters.`,
      },
      {
        key: "warns",
        label: <>warn {warns}</>,
        tone: warns > 0 ? "default" : "muted",
      },
      {
        key: "errors",
        label: <>errors {errors}</>,
        tone: errors > 0 ? "attention" : "muted",
      },
    ],
  };
}
