/**
 * federationStatus — the derived state of one memory-federation report, and
 * R3's audited severity table for it.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 4 (Family C, D2). Derivation lives in a pure, unit-tested module rather
 * than inline in JSX (R8), the shape `alertStatus.ts` established.
 *
 * ## What this replaces, and why it is an R3 fix rather than a repaint
 *
 * The route painted its severity twice, both times inline and neither time
 * audited: a `text-destructive` class on the Fail COUNT cell
 * (`page.tsx:359-365`) and a `destructive` tile when the fleet-wide fail total
 * was non-zero (`:110`). Nothing tied those two to a declared attention, so
 * "is this red?" was answerable only by reading the JSX. Now the row's hue and
 * the row's declared owner come out of one table that a test audits.
 *
 * ## The R3 reading, kind by kind
 *
 * The question this surface has to answer is *whose move is it when a
 * federation run reports failures?* — and the honest answer is nobody else's.
 * A federation report is a **finished** run's receipt. Nothing re-runs it and
 * nothing retries the names it could not push, so a non-zero `failed` is the
 * definition of R3's red: someone must act now, and no process will clear it.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { AUTHOR_RED, INERT } from "@/components/console/statusRow";

/** The vocabulary the row renders. */
export type FederationReportKind = "synced" | "partial" | "idle";

/**
 * The audited kind → attention table. TOTAL over
 * {@link FederationReportKind}, one documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `synced` | `none` | The run moved memories and reported no failure. Terminal and finished — nobody's move. |
 * | `partial` | `author` | At least one memory FAILED to federate. The run is over; nothing retries it and no timer clears it, so the memory stays unreplicated until a human looks. That is exactly R3's red. |
 * | `idle` | `none` | The run pushed nothing, pulled nothing and failed nothing. A no-op is not a defect — a session with no new memories has nothing to federate. Calm, and the row says so in words. |
 *
 * None of these is the R3 ignorance floor: a report is a receipt with three
 * integers on it, so we always know what the row's state is. There is no
 * "we cannot tell" case to floor at amber.
 */
export const FEDERATION_ATTENTION_BY_KIND: Record<
  FederationReportKind,
  Attention
> = {
  synced: "none",
  partial: "author",
  idle: "none",
};

export const FEDERATION_KIND_CLASS: Record<FederationReportKind, string> = {
  synced: "bg-green-500/15 text-green-200 border-green-500/30",
  partial: AUTHOR_RED,
  idle: INERT,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const FEDERATION_AUTHOR_GLYPH_KINDS: ReadonlySet<FederationReportKind> =
  new Set(
    (
      Object.keys(FEDERATION_ATTENTION_BY_KIND) as FederationReportKind[]
    ).filter((k) => FEDERATION_ATTENTION_BY_KIND[k] === "author")
  );

export const FEDERATION_STATUS_PALETTE: StatusPalette<FederationReportKind> = {
  badgeClass: FEDERATION_KIND_CLASS,
  authorGlyphKinds: FEDERATION_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<FederationReportKind>(["synced"]),
};

/** The three integers a report carries — all this derivation needs. */
export interface FederationCounts {
  pushed?: number | null;
  pulled?: number | null;
  failed?: number | null;
}

const LABEL_BY_KIND: Record<FederationReportKind, string> = {
  synced: "synced",
  partial: "failures",
  idle: "nothing to sync",
};

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * The row's status. Precedence is failure-first: a run that pushed 40
 * memories and failed 1 is a `partial`, not a `synced` with a footnote.
 */
export function deriveFederationStatus(
  report: FederationCounts
): RowStatus<FederationReportKind> {
  const failed = n(report.failed);
  const moved = n(report.pushed) + n(report.pulled);
  const kind: FederationReportKind =
    failed > 0 ? "partial" : moved > 0 ? "synced" : "idle";
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason:
      kind === "partial"
        ? `${failed} memor${failed === 1 ? "y" : "ies"} did not federate — this run is over and nothing retries them`
        : kind === "idle"
          ? "this session had no new memories to move"
          : undefined,
    attention: FEDERATION_ATTENTION_BY_KIND[kind],
  };
}
