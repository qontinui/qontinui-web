/**
 * share / ShareBar / ShareList — the console's part-of-a-whole primitives.
 *
 * Style guide §3.7. The formatter's ends are the whole point (a `toFixed(1)`
 * rounds 9999/10000 to a false `100.0%` and 1/10000 to a false `0.0%`), and a
 * share over nothing is the R6 dash, never `0%` and never `100%`.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SHARE_UNKNOWN, share, shareOfFraction } from "./share";
import { ShareBar, ShareList, rankShares, shareFraction } from "./ShareBar";

describe("share()", () => {
  it("reserves 100% and 0% for the exact ends", () => {
    expect(share(7, 7)).toBe("100%");
    expect(share(0, 7)).toBe("0%");
  });

  it("hedges a near-end value instead of rounding into a false claim", () => {
    expect(share(9999, 10000)).toBe(">99.9%");
    expect(share(1, 10000)).toBe("<0.1%");
  });

  it("formats the interior to one decimal", () => {
    expect(share(1, 3)).toBe("33.3%");
    expect(share(3, 5)).toBe("60.0%");
  });

  it("refuses a share over nothing — 0 of 0 is not full coverage", () => {
    expect(share(0, 0)).toBe(SHARE_UNKNOWN);
    expect(share(1, -2)).toBe(SHARE_UNKNOWN);
    expect(share(Number.NaN, 4)).toBe(SHARE_UNKNOWN);
    expect(share(5, 4)).toBe(SHARE_UNKNOWN);
    expect(share(-1, 4)).toBe(SHARE_UNKNOWN);
  });
});

describe("shareOfFraction()", () => {
  it("treats coord's null rate as unknown, not zero", () => {
    expect(shareOfFraction(null)).toBe(SHARE_UNKNOWN);
    expect(shareOfFraction(undefined)).toBe(SHARE_UNKNOWN);
  });

  it("agrees with share() at the ends and between", () => {
    expect(shareOfFraction(1)).toBe("100%");
    expect(shareOfFraction(0)).toBe("0%");
    expect(shareOfFraction(0.9999)).toBe(">99.9%");
    expect(shareOfFraction(0.0001)).toBe("<0.1%");
    expect(shareOfFraction(0.25)).toBe("25.0%");
  });

  it("refuses a value outside the unit interval", () => {
    expect(shareOfFraction(1.2)).toBe(SHARE_UNKNOWN);
    expect(shareOfFraction(-0.1)).toBe(SHARE_UNKNOWN);
    expect(shareOfFraction(Number.POSITIVE_INFINITY)).toBe(SHARE_UNKNOWN);
  });
});

describe("shareFraction / rankShares", () => {
  it("returns null for every shape of unknown", () => {
    expect(shareFraction(null, 4)).toBeNull();
    expect(shareFraction(1, null)).toBeNull();
    expect(shareFraction(1, 0)).toBeNull();
    expect(shareFraction(2, 4)).toBe(0.5);
  });

  it("ranks by count descending and keeps ties in input order", () => {
    const ranked = rankShares([
      { key: "a", count: 1 },
      { key: "b", count: 5 },
      { key: "c", count: 1 },
      { key: "d", count: 3 },
    ]);
    expect(ranked.map((r) => r.key)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("<ShareBar>", () => {
  it("renders the formatted share and a filled track for a known share", () => {
    render(<ShareBar numerator={3} denominator={4} data-testid="bar" />);
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveTextContent("75.0%");
    expect(bar).toHaveAttribute("data-share-known", "true");
    expect(bar).toHaveAttribute("title", "3 of 4");
  });

  it("renders the dash and NO fill for an unknown whole", () => {
    const { container } = render(
      <ShareBar numerator={0} denominator={0} data-testid="bar" />
    );
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveTextContent(SHARE_UNKNOWN);
    expect(bar).toHaveAttribute("data-share-known", "false");
    // The dashed track is the unknown glyph; a solid empty track would read
    // as a measured 0.
    expect(container.querySelector(".border-dashed")).not.toBeNull();
    expect(container.querySelector('[style*="width"]')).toBeNull();
  });

  it("never paints the bar in an attention hue", () => {
    const { container } = render(<ShareBar numerator={9} denominator={10} />);
    expect(container.innerHTML).not.toMatch(/\b(bg|text|border)-(red|amber)-/);
  });
});

describe("<ShareList>", () => {
  it("ranks its lines and states each line's share of the total", () => {
    render(
      <ShareList
        data-testid="list"
        total={10}
        items={[
          { key: "small", label: "Small class", count: 2 },
          { key: "big", label: "Big class", count: 8 },
        ]}
      />
    );
    const lines = within(screen.getByTestId("list")).getAllByRole("listitem");
    expect(lines.map((l) => l.getAttribute("data-share-key"))).toEqual([
      "big",
      "small",
    ]);
    expect(lines[0]).toHaveTextContent("Big class");
    expect(lines[0]).toHaveTextContent("80.0%");
    expect(lines[1]).toHaveTextContent("20.0%");
  });

  it("shows the dash on every line when the total is unknown", () => {
    render(
      <ShareList
        data-testid="list"
        total={null}
        items={[{ key: "x", label: "X", count: 2 }]}
      />
    );
    expect(screen.getByTestId("list")).toHaveTextContent(SHARE_UNKNOWN);
  });

  it("renders the caller's empty state, and no list, when there are no items", () => {
    render(
      <ShareList
        data-testid="list"
        total={0}
        items={[]}
        empty={<p>nothing measured</p>}
      />
    );
    expect(screen.queryByTestId("list")).toBeNull();
    expect(screen.getByText("nothing measured")).toBeInTheDocument();
  });

  it("has no per-line action — an aggregate is read, not acted on", () => {
    render(
      <ShareList
        data-testid="list"
        total={3}
        items={[{ key: "x", label: "X", count: 3 }]}
      />
    );
    expect(within(screen.getByTestId("list")).queryAllByRole("button")).toEqual(
      []
    );
  });
});
