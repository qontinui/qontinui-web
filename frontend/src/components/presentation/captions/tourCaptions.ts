/**
 * Captions for the tour (`/admin/coord/tour`, plan
 * `2026-10-23-console-presentation-spaces` D5 and Phase 8), and the tour
 * bar's own words.
 *
 * The tour sequences the lens pages; each stop's one sentence is that page's
 * own `<surface>.page` caption, which the stop page renders itself, so a
 * stop's caption and its page's caption are one entry and cannot disagree —
 * the tour never repeats it. What lives here is only what is the tour's own:
 *
 * - **caption entries**, keyed `tour.<part>`, for the tour page and its
 *   sections and for each labelled state the tour shows (a stop that is or is
 *   not ready, no stop at all, a page off the route) — a title, one sentence,
 *   and why it matters;
 * - **{@link TOUR_LABELS}**, the bar's control and position words: text on a
 *   control or a counter, too short to carry a sentence of its own.
 *
 * Every sentence is a claim about the product and is checked against the
 * code: "prepared for presentation" is `PRESENTATION_READY_ROUTES`
 * membership, whose test every full run re-checks
 * (`presentationReadiness.ts`), and the tour links only to such a page
 * (`tour/tourModel.ts`). `tourCaptions.test.ts` pins the claims.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const TOUR_CAPTIONS = {
  "tour.page": {
    title: "Tour",
    // No count of stops: a stop whose page is not prepared yet is skipped,
    // so "five pages" would claim a walk the tour does not take.
    oneLiner: copy`A guided walk, one stop at a time, through the ${term("operator", "operator")}'s own working pages, each shown live in presentation mode.`,
    whyItMatters:
      "Every stop is a real working page with its live data, not a separate demo, so what you are shown is what actually runs.",
  },
  // Its title is the link's own text: the page renders it `untitled`.
  "tour.start": {
    title: "Start the tour",
    oneLiner:
      "Opens the first stop that can be presented, with a tour bar above it whose Previous and Next, or the left and right arrow keys, move between the stops.",
    whyItMatters:
      "Every step is an ordinary link to the real page in presentation mode, and End tour leaves the tour without leaving presentation mode.",
  },
  "tour.stops": {
    title: "Stops",
    oneLiner:
      "The pages the tour visits, in order, and whether each one can be shown yet.",
    whyItMatters:
      "Every stop is listed, so a page that is not ready yet is visible as such rather than silently left out.",
  },
  "tour.ready": {
    title: "Ready to present",
    oneLiner:
      "Its page is prepared for presentation, so the tour opens it.",
    whyItMatters:
      "A page counts as prepared only after a test has checked that its presentation view shows no control that changes anything, no cost and none of the names it must not show, and every full test run checks it again.",
  },
  "tour.not-presentable": {
    title: "Not yet presentable",
    oneLiner:
      "Its page is not prepared for presentation yet, so the tour lists it but never opens it.",
    whyItMatters:
      "Presentation mode keeps an unprepared page off screen, so the tour skips the stop instead of leading to an empty placeholder.",
  },
  "tour.no-stops": {
    title: "No stop can be presented yet",
    oneLiner:
      "None of the tour's pages is prepared for presentation yet, so the tour has nowhere to start.",
    whyItMatters:
      "The tour opens only prepared pages, and it says so here instead of offering a start that leads nowhere.",
  },
  "tour.off-route": {
    title: "Off the tour route",
    oneLiner: "This page is not one of the tour's stops.",
    whyItMatters:
      "Going back returns to where the tour left off, and the tour carries on from there.",
  },
} as const satisfies SurfaceCaptions<"tour">;

/** Why a previous or next control leads nowhere — the tail of its accessible name. */
const MISSING = {
  "start-of-tour": "this is the start of the tour",
  "first-stop": "this is the first stop",
  "no-earlier-stop": "no earlier stop can be presented",
  "no-later-stop": "no later stop can be presented",
  "no-presentable-stop": "no stop can be presented yet",
} as const;

/**
 * The tour bar's control and position words, and the tour page's count.
 * An accessible name begins with the control's visible text ("Next" →
 * "Next stop: Dev Ops"), so a voice user can say what they see.
 */
export const TOUR_LABELS = {
  /** The bar's accessible name. */
  bar: "Tour",
  /** The list of stops in the bar. */
  progress: "Tour stops",
  /** The bar's position on the tour page itself. */
  atStart: "Start of the tour",
  /** The position at a presentable stop: counted over the presentable stops. */
  stopOf: (ordinal: number, presentable: number) =>
    `Stop ${ordinal} of ${presentable}`,
  /**
   * Beside the position, when some stops are not presentable — so the "of N"
   * names its population against a list that shows more.
   */
  moreNotPresentable: (count: number) =>
    count === 1
      ? "1 more is not yet presentable"
      : `${count} more are not yet presentable`,
  previous: "Previous",
  next: "Next",
  previousStop: (title: string) => `Previous stop: ${title}`,
  nextStop: (title: string) => `Next stop: ${title}`,
  backTo: (title: string) => `Back to ${title}`,
  backToStart: "Back to the tour start",
  /** A control with nowhere to go: its visible word, and why. */
  missing: (control: string, reason: keyof typeof MISSING) =>
    `${control}: ${MISSING[reason]}`,
  endTour: "End tour",
  endTourTitle:
    "Leave the tour in this tab. The page stays in presentation mode.",
  /** The tour page's count of the stops that can be presented. */
  readyCount: (ready: number, total: number) =>
    `${ready} of ${total} stops ${ready === 1 ? "is" : "are"} ready to present.`,
} as const;
