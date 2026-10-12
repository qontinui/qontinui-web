/**
 * "Shipped by" — who coord's commit lineage says realised a work unit, read
 * from coord's admin-console-only attribution door and laid out WITHOUT
 * guessing a single name.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 7
 * (backed by Phase 0d, qontinui-coord `work_unit_attribution.rs`). The body:
 *
 * ```json
 * {"slug": "…", "attribution_available": true,
 *  "shipped_by": [{"session_name": "plan-foo", "pr_refs": [
 *    {"repo": "o/r", "pr_number": 12, "merged": true,
 *     "attribution_is_single_session": true}]}],
 *  "unnamed_session_count": 1, "unverified_session_count": 0,
 *  "unattributed_pr_count": 2}
 * ```
 *
 * The honesty rules this module exists to hold:
 *
 * - **A count coord did not report is UNKNOWN, never 0.** `null` (coord could
 *   not look) and ABSENT (a coord that predates the field) both render as
 *   "not reported", so an older coord's body never reads as "every session was
 *   verified".
 * - **No names is not nobody.** An empty `shipped_by` beside a non-zero count
 *   says "coord cannot show who", and only an answer whose every count is a
 *   reported 0 reads as "no cited PR".
 * - **`attribution_available: false` is UNKNOWN**, with coord's reason.
 * - **One session per PR.** coord attributes each PR to ONE session, so the
 *   list can under-report contributors; the panel says so.
 */

export interface AttributionPrRef {
  repo: string;
  /** `null` when coord's citation carried no PR number. */
  prNumber: number | null;
  /** coord's tri-state: `null` is UNKNOWN, not "unmerged". */
  merged: boolean | null;
}

export interface AttributionGroup {
  sessionName: string;
  prs: AttributionPrRef[];
}

export type AttributionReading =
  | { state: "pending" }
  | { state: "failed"; reason: string; status: number | null }
  | { state: "unparseable"; reason: string }
  | { state: "unavailable"; reason: string; detail: string | null }
  | {
      state: "loaded";
      groups: AttributionGroup[];
      /** `null` = not reported (UNKNOWN). */
      unnamedSessions: number | null;
      /** `null` = not reported — an older coord sends no such field. */
      unverifiedSessions: number | null;
      /** `null` = not reported (UNKNOWN). */
      unattributedPrs: number | null;
      /** Did any PR ref carry `attribution_is_single_session: true`? */
      singleSessionPerPr: boolean;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A count field: a non-negative integer, or `null` when coord sent `null` or
 *  omitted it (UNKNOWN / an older coord). A PRESENT value of any other shape
 *  is `"malformed"` — never silently read as "not reported". */
function count(v: unknown): number | null | "malformed" {
  if (v === undefined || v === null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : "malformed";
}

/** Read coord's body into a reading. Anything unexpected is `unparseable`. */
export function deriveAttribution(body: unknown): AttributionReading {
  if (!isRecord(body)) {
    return { state: "unparseable", reason: "the response is not an object" };
  }
  const available = body.attribution_available;
  if (available === false) {
    return {
      state: "unavailable",
      reason:
        typeof body.unavailable_reason === "string"
          ? body.unavailable_reason
          : "no reason given",
      detail:
        typeof body.unavailable_detail === "string"
          ? body.unavailable_detail
          : null,
    };
  }
  if (available !== true) {
    return {
      state: "unparseable",
      reason: "the response carries no attribution_available flag",
    };
  }
  if (!Array.isArray(body.shipped_by)) {
    return { state: "unparseable", reason: "shipped_by is not a list" };
  }
  const groups: AttributionGroup[] = [];
  let singleSessionPerPr = false;
  for (const entry of body.shipped_by) {
    if (
      !isRecord(entry) ||
      typeof entry.session_name !== "string" ||
      !Array.isArray(entry.pr_refs)
    ) {
      return {
        state: "unparseable",
        reason: "a shipped_by entry has no session_name or pr_refs",
      };
    }
    const prs: AttributionPrRef[] = [];
    for (const ref of entry.pr_refs) {
      if (!isRecord(ref) || typeof ref.repo !== "string") {
        return { state: "unparseable", reason: "a pr_ref has no repo" };
      }
      if (ref.attribution_is_single_session === true) singleSessionPerPr = true;
      prs.push({
        repo: ref.repo,
        prNumber: typeof ref.pr_number === "number" ? ref.pr_number : null,
        merged: typeof ref.merged === "boolean" ? ref.merged : null,
      });
    }
    groups.push({ sessionName: entry.session_name, prs });
  }
  const unnamedSessions = count(body.unnamed_session_count);
  const unverifiedSessions = count(body.unverified_session_count);
  const unattributedPrs = count(body.unattributed_pr_count);
  if (
    unnamedSessions === "malformed" ||
    unverifiedSessions === "malformed" ||
    unattributedPrs === "malformed"
  ) {
    return { state: "unparseable", reason: "a count is not a non-negative integer" };
  }
  return {
    state: "loaded",
    groups,
    unnamedSessions,
    unverifiedSessions,
    unattributedPrs,
    singleSessionPerPr,
  };
}

/** How one PR ref reads: `o/r#12 (merged)`, with UNKNOWN said, not hidden. */
export function describePrRef(ref: AttributionPrRef): string {
  const id =
    ref.prNumber === null ? `${ref.repo} (no PR number)` : `${ref.repo}#${ref.prNumber}`;
  const merged =
    ref.merged === true
      ? "merged"
      : ref.merged === false
        ? "not merged"
        : "merge state UNKNOWN";
  return `${id} (${merged})`;
}

export interface ShippedByDescription {
  /** The one-line answer. */
  summary: string;
  /** True when the summary is a statement of what coord does NOT know. */
  unknown: boolean;
  /** Qualifications that must sit beside the names, in display order. */
  notes: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The words for a reading. Never renders an unreported count as 0. */
export function describeShippedBy(r: AttributionReading): ShippedByDescription {
  switch (r.state) {
    case "pending":
      return { summary: "reading…", unknown: true, notes: [] };
    case "failed":
      if (r.status === 403) {
        return {
          summary: "not available to this sign-in — UNKNOWN",
          unknown: true,
          notes: [
            "coord serves shipped-by names to an interactive operator console session only.",
          ],
        };
      }
      if (r.status === 404) {
        return {
          summary: "UNKNOWN — coord answered 404",
          unknown: true,
          notes: [
            "Either coord holds no work unit for this stem, or this backend does not serve the attribution door.",
          ],
        };
      }
      return {
        summary: "UNKNOWN — the attribution read failed",
        unknown: true,
        notes: [r.reason],
      };
    case "unparseable":
      return {
        summary: "UNKNOWN — coord's answer could not be read",
        unknown: true,
        notes: [r.reason],
      };
    case "unavailable":
      return {
        summary: `UNKNOWN — coord could not attribute this unit (${r.reason})`,
        unknown: true,
        notes: r.detail ? [r.detail] : [],
      };
    case "loaded": {
      const notes: string[] = [];
      // Only names can be unverified; with none on screen an older coord's
      // missing count qualifies nothing.
      if (r.unverifiedSessions === null) {
        if (r.groups.length > 0) {
          notes.push(
            "Whether every attributed session was verified as this tenant's was not reported by this coord."
          );
        }
      } else if (r.unverifiedSessions > 0) {
        notes.push(
          `${plural(r.unverifiedSessions, "attributed session", "attributed sessions")} could not be verified as this tenant's — name withheld, not guessed.`
        );
      }
      if (r.unnamedSessions === null) {
        notes.push("The number of sessions with no name was not reported.");
      } else if (r.unnamedSessions > 0) {
        notes.push(
          `${plural(r.unnamedSessions, "session", "sessions")} of this tenant shipped work under no recorded name.`
        );
      }
      if (r.unattributedPrs === null) {
        notes.push("The number of cited PRs with no session attribution was not reported.");
      } else if (r.unattributedPrs > 0) {
        notes.push(
          `${plural(r.unattributedPrs, "cited PR has", "cited PRs have")} no session attribution — coord does not know who.`
        );
      }
      if (r.groups.length > 0 && r.singleSessionPerPr) {
        notes.push(
          "coord attributes each PR to one session, so other contributors may be missing."
        );
      }

      if (r.groups.length > 0) {
        return {
          summary: r.groups.map((g) => g.sessionName).join(", "),
          unknown: false,
          notes,
        };
      }
      // `unverifiedSessions === null` is a coord that predates the field, and
      // such a coord withholds no name — every session it attributes is either
      // named or counted unnamed. So it cannot hide a session here, and the
      // two counts it DOES report decide "no cited PR" on their own.
      if (
        r.unnamedSessions === 0 &&
        r.unattributedPrs === 0 &&
        (r.unverifiedSessions === 0 || r.unverifiedSessions === null)
      ) {
        return {
          summary: "no cited PR — nothing to attribute",
          unknown: false,
          notes,
        };
      }
      return {
        summary: "no session name coord can show — UNKNOWN who",
        unknown: true,
        notes,
      };
    }
  }
}
