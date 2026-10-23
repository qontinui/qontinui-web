/**
 * HeadlineFigures — a lens page's headline strip (plan
 * `2026-10-23-console-presentation-spaces` Phase 7). Presentation-only; a
 * known figure shows its value, detail and a KNOWN provenance chip; an
 * unknown one shows the word UNKNOWN on the ignorance-floor amber, its
 * reason, and an UNKNOWN as-of — never a zero.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { FixedPresentationMode } from "./PresentationModeProvider";
import { HeadlineFigures, type HeadlineFigure } from "./HeadlineFigures";

/** Built per test, so the 12-second age is measured from the render. */
const figures = (): HeadlineFigure[] => [
  {
    key: "machines",
    label: "Machines healthy",
    value: {
      state: "known",
      value: "6 of 8",
      detail: "Healthy by coord's own check.",
      asOf: Date.now() - 12_000,
    },
    source: "coord fleet health",
    "data-testid": "fig-machines",
  },
  {
    key: "workspaces",
    label: "Agent workspaces in use",
    value: { state: "unknown", reason: "The latest read failed." },
    source: "coord worktree slots",
    "data-testid": "fig-workspaces",
  },
];

describe("HeadlineFigures", () => {
  it("renders nothing for the operator, or outside any lens", () => {
    const { container, unmount } = render(
      <FixedPresentationMode presenting={false}>
        <HeadlineFigures figures={figures()} />
      </FixedPresentationMode>
    );
    expect(container).toBeEmptyDOMElement();
    unmount();
    const bare = render(<HeadlineFigures figures={figures()} />);
    expect(bare.container).toBeEmptyDOMElement();
  });

  it("renders a known figure with its value, detail and a known provenance chip", () => {
    render(
      <FixedPresentationMode presenting>
        <HeadlineFigures figures={figures()} data-testid="strip" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("strip")).toHaveAttribute(
      "data-presentation-headline"
    );
    const fig = screen.getByTestId("fig-machines");
    expect(fig).toHaveAttribute("data-headline-known", "true");
    expect(fig).toHaveTextContent("Machines healthy");
    expect(fig).toHaveTextContent("6 of 8");
    expect(fig).toHaveTextContent("Healthy by coord's own check.");
    const chip = screen.getByTestId("fig-machines-provenance");
    expect(chip).toHaveAttribute("data-provenance-known", "true");
    expect(chip).toHaveTextContent("source: coord fleet health");
    expect(chip).toHaveTextContent("as of 12s ago");
  });

  it("renders an unknown figure as UNKNOWN on amber with its reason — never 0, never blank", () => {
    render(
      <FixedPresentationMode presenting>
        <HeadlineFigures figures={figures()} />
      </FixedPresentationMode>
    );
    const fig = screen.getByTestId("fig-workspaces");
    expect(fig).toHaveAttribute("data-headline-known", "false");
    const value = fig.querySelector('[data-headline-part="value"]')!;
    expect(value.textContent).toBe("UNKNOWN");
    expect(value.firstElementChild!.className).toContain(UNKNOWN_AMBER);
    expect(fig).toHaveTextContent("The latest read failed.");
    expect(fig.textContent).not.toMatch(/\b0\b/);
    // No answer arrived, so nothing is dated — even though a source exists.
    const chip = screen.getByTestId("fig-workspaces-provenance");
    expect(chip).toHaveAttribute("data-provenance-known", "false");
    expect(chip).toHaveTextContent("source: coord worktree slots");
    expect(chip).toHaveTextContent("as of UNKNOWN");
  });

  it("renders nothing for an empty figure list", () => {
    const { container } = render(
      <FixedPresentationMode presenting>
        <HeadlineFigures figures={[]} />
      </FixedPresentationMode>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
