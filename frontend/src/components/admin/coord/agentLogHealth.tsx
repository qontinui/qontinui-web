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
 *
 * ## A failed read is not an empty log
 *
 * R6's absence-is-not-zero clause covers "fetched and FAILED", not only "still
 * in flight" — see the style guide's R6 note, which cites `/admin/coord/questions`
 * shipping a GREEN "No agent is waiting on an answer" off a read that errored.
 * This strip had the same hole in both directions: with no rows yet it claimed
 * "Waiting for coord…" forever (nothing was coming — the read had failed), and
 * with rows retained from an earlier poll it painted the green "No errors or
 * warnings" off a window of unknown age. `loaded` cannot tell either case
 * apart, so the failure gets its own argument.
 *
 * Two arms: a failure on a page coord has NEVER answered is UNKNOWN and dashes
 * its counts, while a failure after any successful read is STALE — real numbers
 * the operator can still act on, so they keep rendering and the detail line
 * says they are old. `readIsUnknown` carries why the split is `loaded` rather
 * than "the window is empty".
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import {
  UNKNOWN_COUNTS_DETAIL,
  readIsUnknown,
  staleDetail,
} from "@/components/console";
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
 * The two early returns spell the dash LITERALLY in their badge labels.
 * `<HealthStrip>` renders `badge.label` verbatim, so a `null` label renders
 * NOTHING rather than `–`; R6's absence-is-not-zero rule is held here by these
 * returns, not by any null-coalescing further down. A page that has not heard
 * from coord — or that asked and was refused — must not claim this agent logged
 * no errors.
 *
 * They are ordered failure-first on purpose: a first load that ERRORS leaves
 * `loaded` false as well, so a `!loaded`-first reading renders "Waiting for
 * coord…" over a request that already came back and is never coming again.
 *
 * @param readFailed the page's last fetch threw. Distinct from `!loaded`:
 *   `loaded` says whether coord has ever answered, this says whether the most
 *   recent attempt failed.
 */
export function deriveAgentLogHealth(
  filtered: AgentLogRow[],
  total: number,
  loaded: boolean,
  readFailed = false
): AgentLogHealth {
  // Failed, and coord has never answered: UNKNOWN. See `readIsUnknown` for why
  // this is keyed on `loaded` and not on the window being empty — an agent that
  // has genuinely logged nothing would otherwise flip to "unknown" and back on
  // every blipped poll.
  if (readIsUnknown(loaded, readFailed)) {
    return {
      level: "amber",
      headline: "Could not read this agent's log — unknown, not empty",
      detail: UNKNOWN_COUNTS_DETAIL,
      badges: [
        { key: "rows", label: <>rows –</>, tone: "muted" },
        { key: "warns", label: <>warn –</>, tone: "muted" },
        { key: "errors", label: <>errors –</>, tone: "muted" },
      ],
    };
  }

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

  // A STALE verdict is not a GREEN verdict — R6's third state, the same clause
  // `derivePlansHealth` carries. The counts survive a failed refresh because
  // they were really measured, but the dot is a claim about NOW and the last
  // good read is not now. `readFailed` used to reach only the detail line, so
  // an agent log that loaded cleanly and then went dark pulsed green under
  // "No errors or warnings" — the sentence that tells an operator to stop
  // looking — off a window of unknown age.
  //
  // Errors and warnings both outrank it: those rows are real, and a real error
  // is red whether or not the window refreshed. Only the two arms that claim
  // an ABSENCE give way.
  const level: HealthStripLevel =
    errors > 0 ? "red" : warns > 0 || readFailed ? "amber" : "green";
  const headline =
    errors > 0
      ? `${errors} error${errors === 1 ? "" : "s"} in this window`
      : warns > 0
        ? `${warns} warning${warns === 1 ? "" : "s"}, no errors`
        : readFailed
          ? "Last refresh failed — these counts are not current"
          : filtered.length === 0
            ? "Nothing matches the current filters"
            : "No errors or warnings";
  const window =
    total === filtered.length
      ? `${total} row${total === 1 ? "" : "s"} in the fetched window`
      : `${filtered.length} of ${total} rows shown — filters are active`;
  // Rows an earlier poll delivered are real, so they keep rendering; what is
  // unknown is only their AGE.
  const detail = readFailed ? staleDetail(window) : window;

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
