/**
 * Console-error policy for Spec CI — the run-level invariant that replaces the
 * `ui-bridge-graph-editor.spec.ts` `@smoke` "no critical console errors" test.
 *
 * This module is policy-only (no Playwright dependency) so the denylist /
 * critical-set is reviewable + diffable in isolation. The harness
 * (`run-spec-ci.ts`) owns the `page.on(...)` attachment and attribution; it
 * imports `classifyConsole` + `ConsoleErrorEntry` from here.
 *
 * v1 semantics — EXACT equivalence with the retired smoke test
 * (`ui-bridge-graph-editor.spec.ts:331-380`), then strictly broader on the
 * pageerror axis:
 *   - Any `page.on("pageerror")` event (uncaught exception / unhandled
 *     rejection bubbled to the page) is UNCONDITIONALLY critical — broader
 *     than the smoke test, which only inspected `console` text. These are the
 *     highest-signal class (chunk-load failures, top-level throws) and a
 *     `page.on` listener attached at page creation sees them pre-hydration,
 *     which the SDK's in-page hook structurally cannot.
 *   - A `console.error` is critical IFF it does NOT match the benign denylist
 *     AND it DOES match the critical-set (`Uncaught`/`TypeError`/
 *     `ReferenceError`). This is the smoke test's denylist∩critical-set
 *     semantics verbatim — guaranteeing the corpus is green on first run with
 *     no surprise reds. A follow-up may widen this to "any non-denylisted
 *     console.error" once the corpus baseline is known clean (Decision 2
 *     sub-fork: robustness over a one-time corpus cleanup).
 *   - `warn`/`log`/`info`/`debug` never gate (the flaky-red minefield) and are
 *     not recorded in v1 — `consoleErrors[]` holds only gate-relevant
 *     (critical) entries so `summary.consoleErrors.total === 0` is the exact
 *     gate condition. (We deliberately do NOT keep a parallel non-gating
 *     "warnings for context" array: an unconsumed report field is the same
 *     premature abstraction the plan rejects for `codes.json`.)
 */

/**
 * Captured critical console event, attributed to the spec (and, when known,
 * the transition) that was executing when it fired. Playwright surfaces
 * console levels as `console.type()` strings ("error", "warning", "log", …)
 * and uncaught exceptions via the separate `pageerror` event, so the only
 * levels that ever reach a *recorded* (critical) entry are "error" and
 * "pageerror".
 */
export type ConsoleLevel = "error" | "warning" | "log" | "info" | "debug" | "pageerror";

export interface ConsoleErrorEntry {
  specId: string;
  /**
   * Always `"initial-load"` or `null` in v1: the transition walk runs inside
   * `page.evaluate`, opaque to the outer `page.on` listener, so per-transition
   * attribution isn't available. `null` reads as "during spec run".
   */
  transitionId: string | null;
  level: ConsoleLevel;
  text: string;
  stack: string | null;
  ts: number;
}

/**
 * Benign substrings ported verbatim from `ui-bridge-graph-editor.spec.ts:337-342`.
 * A `console.error` whose text matches any of these is dropped before the
 * critical-set check — favicon 404s, dev-server resource hiccups, and React
 * hydration/warning noise are not gate-worthy.
 */
export const BENIGN_DENYLIST: readonly RegExp[] = [
  /net::ERR_/,
  /Failed to load resource/,
  /favicon/,
  /hydration/,
  /Warning:/,
];

/**
 * Critical markers ported from `ui-bridge-graph-editor.spec.ts:373-378`. A
 * surviving (non-denylisted) `console.error` is critical only if its text
 * contains one of these.
 */
export const CRITICAL_SET: readonly RegExp[] = [/Uncaught/, /TypeError/, /ReferenceError/];

/**
 * Classify a captured console/page event into gate-relevance.
 *
 * @param level the Playwright `console.type()` string, or `"pageerror"` for
 *   `page.on("pageerror")` events.
 * @param text  the message text (`console.text()` or `error.message`).
 */
export function classifyConsole(level: string, text: string): "critical" | "ignore" {
  // Uncaught exceptions / page errors are unconditionally real.
  if (level === "pageerror") return "critical";
  // Only the "error" console level can gate; warn/log/info/debug never do.
  if (level === "error") {
    if (BENIGN_DENYLIST.some((re) => re.test(text))) return "ignore";
    if (CRITICAL_SET.some((re) => re.test(text))) return "critical";
    // v1: a non-denylisted, non-critical-set console.error is NOT gated
    // (exact smoke-test equivalence). Widen in a follow-up once baseline-clean.
    return "ignore";
  }
  return "ignore";
}

/**
 * Compile a spec's `metadata.expectedConsoleErrors` waiver list (substring or
 * regex strings) into matchers. Invalid regex falls back to a literal-escaped
 * match so an author's plain-substring waiver always works. Returns `[]` when
 * the field is absent or malformed (the common case — default is
 * "must be console-clean").
 */
export function compileExpectedConsoleErrors(raw: unknown): RegExp[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => {
      try {
        return new RegExp(s);
      } catch {
        return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }
    });
}
