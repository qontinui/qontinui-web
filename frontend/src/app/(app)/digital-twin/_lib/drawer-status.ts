/**
 * The sub-space drawer's Status field: what the page's live probe holds for
 * the row, said so that it stays true beside whatever else the drawer shows
 * (plan `2026-10-23-console-presentation-spaces` Phase 5;
 * `ux-priorities` `a-status-signal-must-observe-the-state-it-names`).
 *
 * The drawer can show two readings of one observer: the probe's answer for the
 * row (its Status), and the drawer's own raw read of it (its Summary, for a
 * row on coord's twin door). They are made at different times and can
 * disagree, so every sentence here names the probe as its source, and the
 * drawer dates it by when the probe read it ({@link drawerStatusAsOf}; for an
 * envelope door, whose Summary is that same answer, the Summary's chip does).
 * Three states need more than that:
 *
 * - The probe holds NO reading (`unknown`): its meaning says there is no
 *   current reading of the observer — unless the drawer's own LATEST read
 *   answered, when the Summary shows one; then it says only that the page has
 *   no status for the observer, and points at the Summary.
 * - The probe's answer for the row is not a reading of the observer — it
 *   could not read it (`error`) or coord refused it (`restricted`) — and the
 *   drawer's own latest read answered: the meaning says what the probe got,
 *   and points at the Summary, so "could not read" never stands unexplained
 *   beside a reading.
 * - The probe's last refresh FAILED over an earlier answer (`refreshFailed`):
 *   the row still shows that answer, which is not current. The label names it
 *   as the last answer ("Last answer: Live"), its dot is the ignorance floor
 *   — the dot says what is true now, and the last answer is not now (style
 *   guide R6) — and its meaning leads with the failure. Its as-of is that
 *   answer's.
 *
 * "Answered" means the drawer's LATEST read answered with a reading
 * (`drawer-reading.ts` `ownReadAnswered`), never that react-query still holds
 * an earlier one: a failed refetch keeps its data, and that is not an answer.
 *
 * Pure functions (unit-tested in `drawer-status.test.ts`; the whole drawer
 * over every state in `SubspaceDetail.matrix.test.tsx`).
 */

import { statusSuffix } from "./failure-text";
import { probeUnread, type ProbeAttempt } from "./probe-read";
import { probeAnswered } from "./resolve";
import {
  STATUS_STYLES,
  errorFinding,
  partialFinding,
  presentStatus,
  upperFirst,
  type StatusStyle,
} from "./status-presentation";
import type { CellStatus, ResolvedSubspace } from "./types";

/** The fields of a row the drawer's Status reads. */
export type DrawerStatusRow = Pick<
  ResolvedSubspace,
  "cellStatus" | "ask_via" | "unknownReason" | "liveProbed" | "error"
> &
  Partial<Pick<ResolvedSubspace, "metrics">>;

/**
 * What the probe found, for each answer that reads the observer or refuses
 * it: a predicate whose subject is the probe, in the past tense, so it reads
 * the same after "Coord's live probe" for a current answer and after "it"
 * for a last answer kept after a failed refresh.
 */
const PROBE_FINDINGS: Readonly<
  Record<"implemented" | "blind" | "served" | "restricted", string>
> = {
  // `implemented` is coverage at or above the backend's full-coverage line.
  implemented:
    "found this observer answering with full coverage for this tenant",
  blind:
    "found this observer built but disabled or unconfigured for this tenant — not the same as unbuilt",
  // No pointer at a report: the drawer shows one only in operator mode, and
  // only once its own read of the observer has answered.
  served:
    "was answered with coord's own report rather than a verdict — served, not graded: neither healthy nor broken",
  restricted:
    "was refused this sub-space, which is Qontinui-internal (readable only by Qontinui's own operators) or, for the outbound budget, admin-only; your other sub-spaces are unaffected",
};

/**
 * The probe's finding for a row it answered ({@link probeAnswered}), as a
 * predicate of the probe; `null` for a status listed as an answer later,
 * before it has one here.
 */
function probeFinding(row: DrawerStatusRow): string | null {
  const status: CellStatus = row.cellStatus;
  if (status === "error") return errorFinding(row.error);
  if (status === "partial") return partialFinding(row);
  return status in PROBE_FINDINGS
    ? PROBE_FINDINGS[status as keyof typeof PROBE_FINDINGS]
    : null;
}

/**
 * The answers that are not a reading of the observer: beside a Summary that
 * is one, their finding is followed by a pointer to it.
 */
const NOT_A_READING: ReadonlySet<CellStatus> = new Set<CellStatus>([
  "error",
  "restricted",
]);

/** The pointer from the Status to the drawer's own reading above it. */
export const OWN_READ_POINTER =
  "the Summary above is this drawer's own read of it.";

/** What the Status field reads beside the drawer's own read. */
export interface DrawerStatusContext {
  /** The probe the row was resolved from: whether its last refresh failed. */
  readonly probe: Pick<ProbeAttempt, "refreshFailed" | "error">;
  /**
   * The drawer's own LATEST read answered with a reading of the observer (a
   * verdict, or a report door's report), shown in the Summary
   * (`drawer-reading.ts` `ownReadAnswered`).
   */
  readonly ownReadAnswered: boolean;
}

/**
 * The status as the sub-space drawer presents it — the cell's label and dot,
 * with a meaning that names the probe as its source and stays true beside the
 * drawer's own read (see the module docblock for the three states that need
 * it). A row the page does not probe, and a probe still in flight, read as
 * their cells do.
 */
export function presentDrawerStatus(
  row: DrawerStatusRow,
  { probe, ownReadAnswered }: DrawerStatusContext
): StatusStyle {
  const style = presentStatus(row);
  // Only a live-probed row is ever `unknown`.
  if (row.cellStatus === "unknown") {
    if (!ownReadAnswered) return style;
    const why = upperFirst(
      row.unknownReason ?? "coord's live probe holds no reading"
    );
    return {
      ...style,
      meaning: `${why}, so this page has no status for this observer; ${OWN_READ_POINTER}`,
    };
  }
  // A row the page does not probe, or a probe in flight: nothing answered.
  if (!probeAnswered(row)) return style;

  const pointer =
    ownReadAnswered && NOT_A_READING.has(row.cellStatus)
      ? ` ${upperFirst(OWN_READ_POINTER)}`
      : "";
  const predicate = probeFinding(row);
  if (!probe.refreshFailed) {
    // A status listed as an answer before it has a finding: what the cell
    // says of it.
    const finding = predicate
      ? `Coord's live probe ${predicate}.`
      : style.meaning;
    return { ...style, meaning: `${finding}${pointer}` };
  }
  const finding = predicate ? `it ${predicate}.` : style.meaning;
  return {
    label: `Last answer: ${style.label}`,
    // What is true now is not known: the ignorance floor, never the last
    // answer's own hue.
    dot: STATUS_STYLES.unknown.dot,
    border: STATUS_STYLES.unknown.border,
    meaning: `Coord's live probe's latest read failed${statusSuffix(probe.error)}, so this is its last answer, not a current status: ${finding}${pointer}`,
  };
}

/**
 * When the probe read what the drawer's Status says (epoch ms; `null` when
 * that time is unknown), or `undefined` when there is nothing to date: a row
 * the page does not probe states a manifest claim, and a probe in flight has
 * not answered. An answer — current, or the last one kept after a failed
 * refresh — is dated by when it was read; an UNKNOWN row by the attempt that
 * left it so (`probeUnread`), as the page's own UNKNOWN figures are.
 */
export function drawerStatusAsOf(
  row: Pick<ResolvedSubspace, "cellStatus" | "liveProbed">,
  probe: ProbeAttempt
): number | null | undefined {
  if (row.cellStatus === "unknown") return probeUnread(probe)?.asOf ?? null;
  return probeAnswered(row) ? probe.asOf : undefined;
}
