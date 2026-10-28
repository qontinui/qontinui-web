/**
 * The tour's words are claims about the product, checked against the code
 * (plan `2026-10-23-console-presentation-spaces` Phase 8; style guide §6.5).
 * Each test pins a load-bearing claim and forbids the one it replaced, so an
 * edit that brings it back fails here:
 *
 * - the tour page does not count its stops: a stop whose page is not
 *   prepared is skipped, so "five pages" (the Phase 1 copy) promised a walk
 *   the tour does not take;
 * - "ready" says what the readiness proof checks (`expectPresentationSafe`:
 *   controls, cost, names) and that every full run checks it again (the
 *   armed readiness reporter) — no more;
 * - "not yet presentable" says the tour never opens such a stop, and
 *   describes the page it would open the way that page describes itself
 *   (`PresentationPage`'s placeholder, "Shown in the operator view only") —
 *   never as an "empty placeholder", which it is not;
 * - the bar's "Stop k of N" counts the presentable stops, and the
 *   accessible name of every control begins with its visible word.
 */

import { describe, expect, it } from "vitest";
import { WITHHELD_PAGE_TITLE } from "../PresentationPage";
import { captionPlainText } from "./captionTypes";
import { TOUR_CAPTIONS, TOUR_LABELS } from "./tourCaptions";

type TourKey = keyof typeof TOUR_CAPTIONS;

/** What the reader is told: the one-liner and why it matters. */
function copyOf(key: TourKey): string {
  const entry = TOUR_CAPTIONS[key];
  return `${captionPlainText(entry.oneLiner)} ${captionPlainText(entry.whyItMatters)}`;
}

describe("tour.page — a walk through real pages, uncounted", () => {
  it("claims real working pages, live, in presentation mode", () => {
    const text = copyOf("tour.page");
    expect(text).toMatch(/own working pages/);
    expect(text).toMatch(/shown live in presentation mode/);
    expect(text).toMatch(/not a separate demo/);
  });

  it("never states how many stops the tour walks", () => {
    expect(copyOf("tour.page")).not.toMatch(/\b(five|four|three|\d+)\b/i);
  });
});

describe("tour.ready / tour.not-presentable — what being prepared means", () => {
  it("says what the check covers, and that every full test run repeats it", () => {
    const text = copyOf("tour.ready");
    expect(text).toMatch(/no control that changes anything/);
    expect(text).toMatch(/no cost/);
    expect(text).toMatch(/names it must not show/);
    expect(text).toMatch(/every full test run checks it again/);
  });

  it("does not claim the check proves the page correct or complete", () => {
    expect(copyOf("tour.ready")).not.toMatch(/\b(correct|complete|guarantee|every page)\b/i);
  });

  it("says a stop that is not prepared is listed and never opened", () => {
    const text = copyOf("tour.not-presentable");
    expect(text).toMatch(/lists it but never opens it/);
    expect(text).toMatch(/keeps an unprepared page off screen/);
  });

  it("describes the page it would open as that page describes itself, never as empty", () => {
    const text = copyOf("tour.not-presentable");
    // Opened while presenting, an unprepared page is `PresentationPage`'s
    // placeholder: the page's title and one-liner, then a note headed
    // WITHHELD_PAGE_TITLE. A new heading there makes this sentence stale.
    expect(text.toLowerCase()).toContain(WITHHELD_PAGE_TITLE.toLowerCase());
    // The placeholder is "an honest 'not part of the presentation', never a
    // blank" (`PresentationPage.tsx`): a caption calling it empty contradicts
    // the screen a presenter reaches from the sidebar.
    expect(text).not.toMatch(/\b(empty|blank)\b/i);
  });
});

describe("the bar's words", () => {
  it("counts over the presentable stops, and names the rest beside it", () => {
    expect(TOUR_LABELS.stopOf(2, 3)).toBe("Stop 2 of 3");
    expect(TOUR_LABELS.moreNotPresentable(1)).toBe(
      "1 more is not yet presentable"
    );
    expect(TOUR_LABELS.moreNotPresentable(2)).toBe(
      "2 more are not yet presentable"
    );
    expect(TOUR_LABELS.readyCount(1, 5)).toBe(
      "1 of 5 stops is ready to present."
    );
    expect(TOUR_LABELS.readyCount(3, 5)).toBe(
      "3 of 5 stops are ready to present."
    );
  });

  it("begins every control's accessible name with its visible word", () => {
    expect(TOUR_LABELS.previousStop("Dev Ops")).toMatch(
      new RegExp(`^${TOUR_LABELS.previous}\\b`)
    );
    expect(TOUR_LABELS.nextStop("Dev Ops")).toMatch(
      new RegExp(`^${TOUR_LABELS.next}\\b`)
    );
    for (const reason of [
      "start-of-tour",
      "first-stop",
      "no-earlier-stop",
      "no-later-stop",
      "no-presentable-stop",
    ] as const) {
      const name = TOUR_LABELS.missing(TOUR_LABELS.previous, reason);
      expect(name.startsWith(`${TOUR_LABELS.previous}: `), reason).toBe(true);
      expect(name.length, reason).toBeGreaterThan(
        `${TOUR_LABELS.previous}: `.length
      );
    }
  });

  it("says End tour leaves presentation mode on", () => {
    expect(TOUR_LABELS.endTourTitle).toMatch(/stays in presentation mode/);
  });
});
