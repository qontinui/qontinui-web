/**
 * The domain cost verdict's audited kind→attention table and palette (style
 * guide R3 / §4.2), registered in `components/console/consoleSurfaces.ts`.
 *
 * It renders on the Overview (`app/(app)/overview/_components/DomainCostSection.tsx`)
 * but lives HERE, inside the console's palette scope, because it is console
 * vocabulary: its reds and ambers make an R3 claim, so the registry's
 * self-enforcement and the "only statusRow mints a colour" scan must reach it.
 *
 * Plan `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8. One row per readout-table verdict, each with the reason it lands
 * where it does:
 *
 * - `compounded` — **none.** The claim held; the fleet proceeds. Nothing is
 *   owed.
 * - `inconclusive` — **none.** The fleet proceeds to domain 3 by rule; the
 *   caution (two in a row read as did-not-compound) is stated in words, not in
 *   the hue — R3's "third case": a real consequence that blocks nobody today.
 * - `did_not_compound` — **author.** The vision's central claim failed as
 *   measured and new domains stop. Whether the vision itself is edited is the
 *   operator's call alone — intent is the one thing no twin holds.
 * - `unfalsifiable` — **waiting.** Nothing can be claimed until attribution
 *   coverage rises, and raising it is the ranked agent work the verdict
 *   names, so it clears itself; it is also a statement of what we do not
 *   know, which R3's ignorance floor paints amber.
 * - `unknown` — **waiting**, the ignorance floor: a verdict string this build
 *   has no row for.
 */

import type { AttentionMap } from "@/components/console/attention";
import type { StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";

export type DomainCostVerdictKind =
  | "compounded"
  | "inconclusive"
  | "did_not_compound"
  | "unfalsifiable"
  | "unknown";

export const DOMAIN_COST_VERDICT_ATTENTION_BY_KIND: AttentionMap<DomainCostVerdictKind> =
  {
    compounded: "none",
    inconclusive: "none",
    did_not_compound: "author",
    unfalsifiable: "waiting",
    unknown: "waiting",
  };

export const DOMAIN_COST_VERDICT_BADGE_CLASS: Record<
  DomainCostVerdictKind,
  string
> = {
  compounded: INERT,
  inconclusive: INERT,
  did_not_compound: AUTHOR_RED,
  unfalsifiable: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const DOMAIN_COST_VERDICT_AUTHOR_GLYPH_KINDS: ReadonlySet<DomainCostVerdictKind> =
  new Set<DomainCostVerdictKind>(["did_not_compound"]);

export const DOMAIN_COST_VERDICT_PALETTE: StatusPalette<DomainCostVerdictKind> =
  {
    badgeClass: DOMAIN_COST_VERDICT_BADGE_CLASS,
    authorGlyphKinds: DOMAIN_COST_VERDICT_AUTHOR_GLYPH_KINDS,
  };
