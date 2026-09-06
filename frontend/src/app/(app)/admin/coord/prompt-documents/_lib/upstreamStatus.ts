/**
 * The list's upstream badge — read entirely off the fields coord serves, and
 * derived from nothing.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing`, Phase 6:
 *
 * > `PromptDocumentList` gains the badge column, driven by the served
 * > `update_available` / `local_modified` — no client-side diffing to decide
 * > it.
 *
 * ## Why this file computes no comparison of its own
 *
 * `local_modified` has a deliberate degrade polarity that only coord can apply.
 * D3 spells it out: an unresolvable digest — an absent publication row, a
 * degraded read, a column this database does not carry — is UNKNOWN and MUST
 * read `local_modified = true`, so the fan-out notifies instead of adopting.
 * That is the OPPOSITE sign to the `unedited_seed` helper it resembles, and a
 * console that recomputed the comparison from bodies it happens to hold would
 * lose the polarity silently: a tenant's own edits would render as clean, and
 * clean is what gets overwritten. So this module reads booleans and formats
 * them. It never compares a body.
 *
 * `update_available` degrades the other way, to `false`, for the matching
 * reason — coord must not offer an update it cannot prove exists.
 *
 * ## The three states worth a badge, and the two that are not
 *
 * | Served fields | Badge | Why |
 * |---|---|---|
 * | `update_available === true` | `Update v<latest>` | The one actionable state. |
 * | `local_modified === true` and a tracked version exists | `Diverged from v<tracked>` | Informative: this tenant edited away from what it adopted, so a future publication will be offered rather than applied. |
 * | anything else | none | See below. |
 *
 * **A document with no upstream gets no badge.** `upstream_publication_version
 * === null` means NO UPSTREAM — hand-authored, or seeded from a compiled
 * constant before any publication existed — which is UNKNOWN, not "up to
 * date". Coord reads such a row as `local_modified = true` by that same
 * polarity, so badging on the boolean alone would mark every unpublished
 * document in the store as diverged. The tracked-version guard is what keeps
 * "UNKNOWN" from rendering as a claim.
 *
 * **A clean, current document gets no badge either.** Every row already carries
 * two or three badges; a third saying "nothing to do here" is the clutter that
 * makes the one badge that matters harder to see.
 *
 * **A coord that predates the channel gets no badge.** All four fields are
 * optional on the wire, and absent is UNKNOWN. Rendering nothing is the only
 * honest option: there is no publication channel to describe.
 */

import type { PromptDocumentSummary } from "../types";

/** How prominently the badge should read. */
export type UpstreamBadgeTone = "attention" | "muted";

export interface UpstreamBadge {
  /** Short label for the badge itself. */
  label: string;
  /** The `title=` explanation — one sentence, no jargon. */
  title: string;
  tone: UpstreamBadgeTone;
  /** Stable suffix for the row's `data-testid`. */
  testId: "update-available" | "diverged";
}

/**
 * The badge for one row, or `null` when there is nothing honest to say.
 *
 * Takes the summary rather than four arguments so the call site cannot
 * accidentally pass a value it computed itself.
 */
export function upstreamBadge(
  doc: Pick<
    PromptDocumentSummary,
    | "upstream_publication_version"
    | "latest_publication_version"
    | "local_modified"
    | "update_available"
  >
): UpstreamBadge | null {
  const tracked = doc.upstream_publication_version ?? null;
  const latest = doc.latest_publication_version ?? null;

  // Coord served the update flag as true — the only actionable state, and the
  // only one that gets the attention tone.
  if (doc.update_available === true) {
    return {
      label: latest === null ? "Update available" : `Update v${latest}`,
      title:
        doc.local_modified === true
          ? tracked === null
            ? "A publication is available for this document. You have never adopted one, so nothing is applied automatically — open it to compare and choose."
            : `A newer publication is available, and this document differs from the v${tracked} it tracks. A modified document is never overwritten — open it to compare and choose.`
          : `A newer publication is available. This document matches the v${tracked} it tracks, so it can take the update as an ordinary version you can restore away from.`,
      tone: "attention",
      testId: "update-available",
    };
  }

  // No update pending, but this tenant has edited away from what it adopted.
  // Guarded on a tracked version: without one, `local_modified` is coord's
  // UNKNOWN degrade rather than an observation about a body.
  if (doc.local_modified === true && tracked !== null) {
    return {
      label: `Diverged from v${tracked}`,
      title: `This document differs from publication v${tracked}, the version it tracks. Nothing is wrong with that — it means a future publication will be offered to you rather than applied.`,
      tone: "muted",
      testId: "diverged",
    };
  }

  return null;
}
