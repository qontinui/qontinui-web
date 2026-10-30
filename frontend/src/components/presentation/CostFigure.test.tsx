/**
 * CostFigure (plan `2026-10-23-console-presentation-spaces` D3.1; served policy
 * `production-and-cost` `per-task-cost-is-a-labelled-equivalent`): the label
 * beside every figure, reported-versus-estimated said, coverage on an
 * aggregate, UNKNOWN never $0 — and in presentation mode no figure at all.
 */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  COST_EQUIVALENT_LABEL,
  COST_WITHHELD_TEXT,
  CostFigure,
  coverageText,
  formatCostAmount,
} from "./CostFigure";
import { FixedPresentationMode } from "./PresentationModeProvider";

function operator(ui: ReactNode) {
  return render(
    <FixedPresentationMode presenting={false}>{ui}</FixedPresentationMode>
  );
}

describe("CostFigure — operator mode", () => {
  it("renders the figure with the policy's label beside it", () => {
    operator(<CostFigure amount={1.5} source="reported" data-testid="cost" />);
    const cost = screen.getByTestId("cost");
    expect(cost).toHaveAttribute("data-cost-figure", "figure");
    expect(cost).toHaveTextContent("$1.50");
    expect(cost).toHaveTextContent(COST_EQUIVALENT_LABEL);
    expect(cost).not.toHaveTextContent("(estimated)");
  });

  it("says when the figure is a price-table estimate, or when nobody can say", () => {
    const { rerender } = operator(
      <CostFigure amount={0.4} source="estimated" data-testid="cost" />
    );
    expect(screen.getByTestId("cost")).toHaveTextContent("(estimated)");
    rerender(
      <FixedPresentationMode presenting={false}>
        <CostFigure amount={0.4} source={null} data-testid="cost" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("cost")).toHaveTextContent("(source unknown)");
  });

  it("renders a task with no usage data as UNKNOWN — never $0 — still labelled", () => {
    for (const amount of [
      null,
      undefined,
      Number.NaN,
      -1,
      Number.POSITIVE_INFINITY,
    ]) {
      const { unmount } = operator(
        <CostFigure amount={amount} source="reported" data-testid="cost" />
      );
      const cost = screen.getByTestId("cost");
      expect(cost, String(amount)).toHaveTextContent("UNKNOWN");
      expect(cost.textContent ?? "", String(amount)).not.toMatch(/\$\s?0/);
      expect(cost).toHaveTextContent(COST_EQUIVALENT_LABEL);
      unmount();
    }
  });

  it("shows an aggregate's coverage", () => {
    operator(
      <CostFigure
        amount={12}
        source="reported"
        coverage={{ known: 7, total: 9, unit: "sessions" }}
        data-testid="cost"
      />
    );
    expect(screen.getByTestId("cost")).toHaveTextContent(
      "cost known for 7 of 9 sessions"
    );
  });
});

describe("CostFigure — presentation mode", () => {
  it("renders a descriptor and nothing of the figure, its label or its coverage", () => {
    const { container } = render(
      <FixedPresentationMode presenting>
        <CostFigure
          amount={1234.56}
          source="estimated"
          coverage={{ known: 7, total: 9 }}
          data-testid="cost"
        />
      </FixedPresentationMode>
    );
    const cost = screen.getByTestId("cost");
    expect(cost).toHaveAttribute("data-cost-figure", "withheld");
    expect(cost).toHaveTextContent(COST_WITHHELD_TEXT);
    const html = container.innerHTML;
    for (const leak of [
      "1234",
      "1,234",
      "$",
      "list-price",
      "estimated",
      "7 of 9",
    ]) {
      expect(html, leak).not.toContain(leak);
    }
  });
});

describe("formatCostAmount / coverageText", () => {
  it("keeps sub-dollar precision instead of fabricating $0.00", () => {
    expect(formatCostAmount(0.0042)).toBe("$0.0042");
    expect(formatCostAmount(0)).toBe("$0.00");
    expect(formatCostAmount(1234.5)).toBe("$1,234.50");
  });

  it("formats another currency, and falls back plainly on an unknown code", () => {
    expect(formatCostAmount(2, "EUR")).toBe("€2.00");
    expect(formatCostAmount(2, "NOT-A-CODE")).toBe("2.00 NOT-A-CODE");
  });

  it("says coverage is unknown rather than inventing it", () => {
    expect(coverageText({ known: 3, total: 4 })).toBe(
      "cost known for 3 of 4 tasks"
    );
    for (const bad of [
      { known: null, total: 4 },
      { known: 3, total: null },
      { known: 5, total: 4 },
      { known: 1.5, total: 4 },
    ]) {
      expect(coverageText(bad), JSON.stringify(bad)).toBe(
        "cost coverage of tasks unknown"
      );
    }
  });
});
