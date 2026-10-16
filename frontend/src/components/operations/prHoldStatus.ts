/**
 * prHoldStatus — the badge palette for a PR's hold state (console style guide
 * R3), rendered by `PrHoldControl`.
 *
 * Plan `2026-10-04-coord-pr-hold-without-github-drafts`, Phase 4. Registered
 * in `console/consoleSurfaces.ts` `CONSOLE_PALETTES`, so it is audited beside
 * every other console palette.
 */

import type { Attention } from "@/components/console/attention";
import {
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type StatusPalette,
} from "@/components/console/statusRow";

/**
 * - `held` — coord holds the PR (`coord.pr_holds`).
 * - `github_draft` — coord holds nothing, but the PR is a GitHub draft, which
 *   coord also treats as a hold (plan D1: `is_held = coord_hold OR draft`).
 *   Drafts still exist on public repos.
 * - `unknown` — coord could not say (a failed read, or a coord build that
 *   serves no `hold` field).
 *
 * "Not held" has no badge: the control renders only its Hold action.
 */
export type PrHoldBadgeKind = "held" | "github_draft" | "unknown";

/**
 * The audited kind → attention table (R3):
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `held` | `waiting` | The PR will not land until its holder (or an operator) releases it — waiting on a named someone, which is amber's contract. |
 * | `github_draft` | `waiting` | Same, but the release happens on GitHub (mark ready for review); coord cannot undraft. |
 * | `unknown` | `waiting` | We cannot say whether it is held. R3's floor for not knowing is amber, never calm. |
 *
 * No `author` row: a hold is not a defect the PR's author must fix.
 */
export const PR_HOLD_ATTENTION_BY_KIND: Record<PrHoldBadgeKind, Attention> = {
  held: "waiting",
  github_draft: "waiting",
  unknown: "waiting",
};

export const PR_HOLD_BADGE_CLASS: Record<PrHoldBadgeKind, string> = {
  held: WAITING_AMBER,
  github_draft: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds. There are none. */
export const PR_HOLD_AUTHOR_GLYPH_KINDS: ReadonlySet<PrHoldBadgeKind> = new Set(
  (Object.keys(PR_HOLD_ATTENTION_BY_KIND) as PrHoldBadgeKind[]).filter(
    (k) => PR_HOLD_ATTENTION_BY_KIND[k] === "author"
  )
);

export const PR_HOLD_STATUS_PALETTE: StatusPalette<PrHoldBadgeKind> = {
  badgeClass: PR_HOLD_BADGE_CLASS,
  authorGlyphKinds: PR_HOLD_AUTHOR_GLYPH_KINDS,
};
