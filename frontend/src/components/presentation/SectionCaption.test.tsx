/**
 * SectionCaption — a lens section's caption plus the provenance of its
 * numbers (plan `2026-10-23-console-presentation-spaces` Phase 7).
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FixedPresentationMode } from "./PresentationModeProvider";
import { SectionCaption } from "./SectionCaption";

describe("SectionCaption", () => {
  it("renders nothing for the operator", () => {
    const { container } = render(
      <FixedPresentationMode presenting={false}>
        <SectionCaption
          id="dev-ops.roles"
          sources={[{ source: "coord dispatch roles", asOf: Date.now() }]}
        />
      </FixedPresentationMode>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the registry caption and one chip per source while presenting", () => {
    render(
      <FixedPresentationMode presenting>
        <SectionCaption
          id="dev-ops.roles"
          data-testid="section"
          sources={[
            { source: "coord dispatch roles", asOf: Date.now() - 5_000 },
            { source: "runner inventory", asOf: null },
          ]}
        />
      </FixedPresentationMode>
    );
    const section = screen.getByTestId("section");
    expect(section).toHaveAttribute("data-presentation-section", "dev-ops.roles");
    expect(
      section.querySelector('[data-presentation-caption="dev-ops.roles"]')
    ).not.toBeNull();
    expect(section).toHaveTextContent("Machine roles");

    const chips = section.querySelectorAll("[data-provenance]");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute("data-provenance-known", "true");
    expect(chips[0]).toHaveTextContent("source: coord dispatch roles");
    // A source with no answer is dated UNKNOWN, not omitted.
    expect(chips[1]).toHaveAttribute("data-provenance-known", "false");
    expect(chips[1]).toHaveTextContent("as of UNKNOWN");
  });

  it("renders the caption alone when the section names no source", () => {
    render(
      <FixedPresentationMode presenting>
        <SectionCaption id="dev-ops.audit" data-testid="section" />
      </FixedPresentationMode>
    );
    const section = screen.getByTestId("section");
    expect(section).toHaveTextContent("Change history");
    expect(section.querySelector("[data-provenance]")).toBeNull();
  });
});
