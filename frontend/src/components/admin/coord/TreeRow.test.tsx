/**
 * TreeRow's branch badge: revealed by the ROW's width, and bounded.
 *
 * The badge sits in a status group that does not shrink, beside the row's
 * label (the tree's primary path, its identifying text). Keyed to a viewport
 * breakpoint it stayed revealed in a narrowed console, and uncapped an agent
 * branch name (`agent/<device>-<id>/<slug>`, past 80 characters) took the
 * width the path needed [policy: ux-priorities/no-widget-may-hide-identifying-text].
 * jsdom has no layout, so these are class contracts; the Spec-CI selectors
 * for this row are pinned separately by `trees/page.specSelectors.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TreeRow, branchBadgeText, type PrimaryTreeRow } from "./TreeRow";
import { expectRowKeyedReveal } from "@/test/recordRowSlot";

const LONG_BRANCH =
  "agent/4b426e2bcc10-01a209baf2db/2026-11-08-consoles-paint-zeros-before-the-first-read-and-th";

function tree(overrides: Partial<PrimaryTreeRow> = {}): PrimaryTreeRow {
  return {
    repo: "qontinui-web",
    primary_path: "/home/op/qontinui-root/qontinui-web",
    branch: LONG_BRANCH,
    behind_count: 0,
    ...overrides,
  };
}

function renderRow(t: PrimaryTreeRow, expanded = false) {
  return render(<TreeRow tree={t} expanded={expanded} onToggle={() => {}} />);
}

const BADGE = "coord-tree-branch-badge";
const SLUG = "2026-11-08-consoles-paint-zeros-before-the-first-read-and-th";

describe("TreeRow — the branch badge", () => {
  it("reveals it by the ROW's width, never the viewport's", () => {
    renderRow(tree());
    expectRowKeyedReveal(
      screen.getByTestId(BADGE),
      "@min-[53rem]/record-row:inline-flex"
    );
  });

  it("caps it and truncates the text, keeping the whole name in its title", () => {
    renderRow(tree());
    const badge = screen.getByTestId(BADGE);
    expect(badge).toHaveAttribute("title", LONG_BRANCH);
    expect(badge.className.split(/\s+/)).toContain("max-w-[24ch]");
    // The text sits in a child that may shrink below its content
    // (`min-w-0`), or the badge's flex box would not let it truncate.
    const text = badge.firstElementChild as HTMLElement;
    expect(text.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-w-0", "truncate"])
    );
  });

  it("shows a long name's last segment, the part that tells agent branches apart", () => {
    renderRow(tree());
    expect(screen.getByTestId(BADGE)).toHaveTextContent(`…/${SLUG}`);
  });

  it("shows a short name whole", () => {
    renderRow(tree({ branch: "feat/spec-ci" }));
    expect(screen.getByTestId(BADGE)).toHaveTextContent(/^feat\/spec-ci$/);
  });

  it("carries the full name in the detail at every width", () => {
    renderRow(tree(), true);
    expect(screen.getByText(LONG_BRANCH)).toBeInTheDocument();
  });

  it("renders no badge when the row carries no branch", () => {
    renderRow(tree({ branch: null }));
    expect(screen.queryByTestId(BADGE)).toBeNull();
  });
});

describe("branchBadgeText", () => {
  it.each([
    ["main", "main"],
    ["feat/spec-ci", "feat/spec-ci"],
    // exactly at the threshold: whole
    ["a".repeat(20), "a".repeat(20)],
    // over it with a segment: the tail
    [LONG_BRANCH, `…/${SLUG}`],
    // over it with no slash, or a trailing slash: whole (the cap truncates)
    ["b".repeat(30), "b".repeat(30)],
    [`${"c".repeat(25)}/`, `${"c".repeat(25)}/`],
  ])("%s → %s", (input, expected) => {
    expect(branchBadgeText(input)).toBe(expected);
  });
});
