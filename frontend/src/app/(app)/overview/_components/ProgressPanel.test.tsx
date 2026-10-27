/**
 * The Summary's Progress panel, rendered from readings made by the real
 * derivation (`progressFromOnTrack` over `parseProjectState`).
 *
 * The panel's honesty rule — "when the counts could not be read, the panel
 * says so and shows no figures" — is what these pin: an unread count is never
 * drawn as a zero, and each partial or missing part of the panel says which it
 * is rather than showing an empty list.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UNIT_CLASSES,
  parseProjectState,
} from "@/components/admin/coord/coordHomeStatus";
import { progressFromOnTrack, type RecentlyFinished } from "../_lib/progress";
import { ProgressPanel } from "./ProgressPanel";

/** Every class at `n`, except those overridden. */
function classes(
  n: number,
  over: Partial<Record<(typeof UNIT_CLASSES)[number], number>> = {}
) {
  return Object.fromEntries(UNIT_CLASSES.map((c) => [c, over[c] ?? n]));
}

/** A reading made the way the page makes it, from coord's on_track block. */
function reading(
  onTrack: Record<string, unknown>,
  recentlyFinished: RecentlyFinished | null = { items: [], partial: false }
) {
  return progressFromOnTrack(
    parseProjectState({ on_track: onTrack })!.onTrack,
    recentlyFinished
  );
}

const READ = {
  state: "read",
  totals: {
    row_count: 6,
    classes: classes(0, { shipped: 3, in_flight: 2, not_started: 1 }),
  },
};

describe("ProgressPanel", () => {
  it.each([
    ["could_not_read", "the count could not be read"],
    ["stale", "the count could not be read"],
    ["not_implemented", "the count could not be read"],
  ])(
    "shows no figure at all when on_track is %s, and says why once",
    (state, reason) => {
      const { container } = render(
        <ProgressPanel reading={reading({ state })} />
      );
      const unknown = container.querySelector(
        '[data-ui-bridge-id="overview.summary.progress.unknown"]'
      );
      expect(unknown).toHaveTextContent(
        `This project’s progress can’t be counted right now (${reason}), so no figures are shown. Try again later.`
      );
      // "right now" is said once, not twice.
      expect(unknown?.textContent?.match(/right now/g)).toHaveLength(1);
      // No figure of any kind: no share, no bucket, no zero.
      expect(container.textContent).not.toMatch(/\d/);
      expect(container.textContent).not.toMatch(/%|Done|Planned/);
      expect(
        container.querySelector(
          '[data-ui-bridge-id="overview.summary.progress"]'
        )
      ).toBeNull();
    }
  );

  it("shows no figure when a read block is missing a class, rather than a low count", () => {
    const { container } = render(
      <ProgressPanel
        reading={reading({
          state: "read",
          totals: { row_count: 1, classes: { shipped: 1 } },
        })}
      />
    );
    expect(container).toHaveTextContent(
      "can’t be counted right now (part of the count is missing)"
    );
    expect(container.textContent).not.toMatch(/%/);
  });

  it("draws the read counts", () => {
    render(<ProgressPanel reading={reading(READ)} />);
    expect(screen.getByText("50%", { selector: "p" })).toBeInTheDocument();
    expect(
      screen.getByText("of the planned work is done: 3 of 6 pieces of work.")
    ).toBeInTheDocument();
  });

  it("says recently finished work could not be loaded when that read failed, never 'nothing finished'", () => {
    render(<ProgressPanel reading={reading(READ, null)} />);
    expect(
      screen.getByText(
        /Recently finished work couldn.t be loaded\. Try again later\./
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing has been finished yet.")
    ).not.toBeInTheDocument();
  });

  it("marks a partial recently-finished list as possibly missing work", () => {
    render(
      <ProgressPanel
        reading={reading(READ, {
          items: [{ title: "A plan", finishedAt: "2026-10-20T00:00:00Z" }],
          partial: true,
        })}
      />
    );
    expect(screen.getByText("A plan")).toBeInTheDocument();
    expect(
      screen.getByText(/so this list may miss something finished recently/)
    ).toBeInTheDocument();
  });

  it("says no finish dates were found in a partial read with none, never 'nothing finished'", () => {
    render(
      <ProgressPanel reading={reading(READ, { items: [], partial: true })} />
    );
    expect(
      screen.getByText("No finish dates were found in what was returned.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing has been finished yet.")
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      2,
      "2 internal bookkeeping records are left out of these counts; they are not project work.",
    ],
    [
      1,
      "1 internal bookkeeping record is left out of these counts; it is not project work.",
    ],
  ])(
    "states the %p bookkeeping units coord left out of the counts",
    (n, sentence) => {
      render(
        <ProgressPanel
          reading={reading({
            ...READ,
            totals: {
              ...READ.totals,
              excluded: { merge_shepherd_bookkeeping: n },
            },
          })}
        />
      );
      expect(screen.getByText(sentence)).toBeInTheDocument();
    }
  );

  it.each([
    ["zero", { merge_shepherd_bookkeeping: 0 }],
    ["not stated", undefined],
  ])(
    "says nothing about bookkeeping when the count is %s",
    (_case, excluded) => {
      const { container } = render(
        <ProgressPanel
          reading={reading({ ...READ, totals: { ...READ.totals, excluded } })}
        />
      );
      expect(container).not.toHaveTextContent(/bookkeeping/);
    }
  );
});
