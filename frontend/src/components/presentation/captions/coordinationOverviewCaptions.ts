/**
 * Captions for the coordination overview lens surface (`/admin/coord/home`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a tile of THIS page adds its entry here, keyed
 * `coordination-overview.<tile>`, and never touches another surface's file.
 *
 * Phase 2 captions every region the page renders, in the order it shows
 * them (`SectionCaption` mounts each, presentation mode only). Every sentence
 * is a claim about the page, checked against it: what each region derives is
 * in `components/admin/coord/coordHomeStatus.ts`, what it renders in
 * `app/(app)/admin/coord/home/_components/HomeSections.tsx`.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const COORDINATION_OVERVIEW_CAPTIONS = {
  "coordination-overview.page": {
    title: "Coordination overview",
    oneLiner: copy`The state of every project on one screen: what is moving, what is waiting, and what needs the ${term("operator", "operator")}.`,
    whyItMatters: copy`Many agents work at once, and the ${term("coord", "coordination service")} keeps their ${term("claim", "claims")}, ${term("work_unit", "work units")} and ${term("gate", "gates")} consistent, so a whole fleet's work reads as one story instead of hundreds of separate events.`,
  },
  "coordination-overview.strip": {
    title: "At a glance",
    oneLiner: copy`One headline for the whole view: whether anything needs the ${term("operator")}, whether anything is degrading, and which parts of the view could not be read.`,
    // `deriveHomeStrip`: green only when every block was read, the sources
    // list was served with nothing unread, nothing needs the operator,
    // nothing is degrading and the latest read did not fail. Anything else
    // floors it at amber, and its detail line says what was not read.
    whyItMatters: copy`The headline turns green only when every part of the view was read and nothing needs attention, so a calm headline is a reading, never a default; anything the ${term("coord", "coordination service")} could not read keeps it amber, and the line under it says what.`,
  },
  "coordination-overview.needs-you": {
    title: "Waiting on the operator",
    // Questions and operator approval gates, in coord's order (oldest
    // first). An approval carries no recommendation, and the row says so.
    oneLiner: copy`The questions and approvals waiting on the ${term("operator")}, oldest first, each shown with the agents' recommendation when one was given.`,
    // The detail lines "Recommended" and "If you overturn it"; the count is
    // coord's own total (`needsDisplayCount`), and "Nothing needs you" is
    // said only over a read block with a zero (`nothingNeedsYou`).
    whyItMatters: copy`Each decision carries what the agents recommend and what changes if it is overturned, so it can be settled in one read; the ${term("coord", "coordination service")} counts them itself, so a list it could not read is shown as ${term("unknown")} rather than as empty.`,
  },
  "coordination-overview.degrading": {
    title: "What is degrading",
    // Each row's time is the onset coord OBSERVED; its detail says whether
    // an agent response is bound (`remediationPhrase`).
    oneLiner: copy`Infrastructure problems that are open now, each with when the ${term("coord", "coordination service")} first observed it and whether an automatic response is bound to it.`,
    // The per-area freshness lines under the list (`planeFreshnessPhrase`).
    whyItMatters:
      "Under the list, each area shows whether its watchers are running on time, so a quiet list can be told apart from a blind one.",
  },
  "coordination-overview.on-track": {
    title: "Work by repository",
    // One row per repository coord groups the units under (plus the units
    // that name none), its summary the four classes `groupSummary` prints.
    oneLiner: copy`Every repository's ${term("work_unit", "work units")} counted by state (shipped, in flight, waiting, or without a recorded change), with the current initiative below.`,
    // A repo row's detail names the units of its two named classes
    // (`NamedUnits`); a count coord did not serve is a dash.
    whyItMatters: copy`The units with no recorded change are named one click down, so slow work is visible by name rather than lost in a total; a count that was not read shows as ${term("unknown")}, never as zero.`,
  },
  "coordination-overview.correct": {
    title: "Is the verified work correct?",
    oneLiner:
      "How much of the work the fleet reports as verified survives an independent check.",
    // `CorrectSection`: "Not measured — no trust-calibration source" when no
    // source exists, "Coord reports a correctness reading; this page does
    // not render it yet" when one does; never a number.
    whyItMatters:
      "It is on the view before anything measures it, so the gap is visible: the view says plainly when it is not measured, or not shown yet, instead of showing a score.",
  },
  "coordination-overview.does-not-know": {
    title: "What this view does not know",
    // Coord's `does_not_know` list: each source, its state, its read time
    // (a watcher's last successful run) and its freshness bound.
    oneLiner: copy`Each source this view is built from, whether the ${term("coord", "coordination service")} could read it, and how fresh it was.`,
    whyItMatters:
      "A view that names what it could not read is one whose calm parts can be trusted: a source that was not read stays on this list, marked as not read, instead of being dropped.",
  },
} as const satisfies SurfaceCaptions<"coordination-overview">;
