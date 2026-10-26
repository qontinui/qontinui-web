/**
 * LensLink — a link from the twin explorer to a console page keeps the
 * presentation (plan `2026-10-23-console-presentation-spaces` D2, D3.2).
 *
 * A tab opened from a link starts with no presentation of its own, so while
 * the lens presents the href itself carries `?present=1`; the page check
 * (`src/test/presentation.tsx`) fails one that does not. Operator mode, and a
 * link that leaves the lens trees, are untouched.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FixedPresentationMode } from "@/components/presentation";
import { LensLink } from "./LensLink";

function hrefOf(
  href: string,
  mode: "operator" | "presenting" | "no-lens"
): string | null {
  const link = (
    <LensLink href={href} data-testid="lens-link" className="a-class">
      the label
    </LensLink>
  );
  render(
    mode === "no-lens" ? (
      link
    ) : (
      <FixedPresentationMode presenting={mode === "presenting"}>
        {link}
      </FixedPresentationMode>
    )
  );
  return screen.getByTestId("lens-link").getAttribute("href");
}

describe("LensLink", () => {
  it("carries ?present=1 to a console page while presenting", () => {
    expect(hrefOf("/admin/coord/work-units/a-plan", "presenting")).toBe(
      "/admin/coord/work-units/a-plan?present=1"
    );
  });

  it("appends to a query the href already has", () => {
    expect(hrefOf("/admin/coord/work-units?x=1", "presenting")).toBe(
      "/admin/coord/work-units?x=1&present=1"
    );
  });

  it("leaves an href alone in operator mode", () => {
    expect(hrefOf("/admin/coord/work-units/a-plan", "operator")).toBe(
      "/admin/coord/work-units/a-plan"
    );
  });

  it("leaves an href alone where no lens is mounted above it", () => {
    expect(hrefOf("/admin/coord/work-units/a-plan", "no-lens")).toBe(
      "/admin/coord/work-units/a-plan"
    );
  });

  it("leaves a link out of the lens trees alone, even while presenting", () => {
    expect(hrefOf("/settings", "presenting")).toBe("/settings");
  });

  it("renders its children and passes its props to the anchor", () => {
    hrefOf("/admin/coord/gates", "presenting");
    const link = screen.getByTestId("lens-link");
    expect(link).toHaveTextContent("the label");
    expect(link).toHaveClass("a-class");
    expect(link.tagName).toBe("A");
  });
});
