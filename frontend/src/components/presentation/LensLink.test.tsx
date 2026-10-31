/**
 * LensLink — a link from a lens page to a page that may not be presentable
 * (plan `2026-10-23-console-presentation-spaces` D2, D3; style guide §6.5).
 *
 * While presenting, a link leads only to a page that can be presented — in a
 * lens tree and registered presentation-ready — and carries `?present=1`, so
 * a tab opened from it presents too. A link to any other page is plain text:
 * out of the lens trees one click would drop the lens, and an unready lens
 * page is a "shown in the operator view only" dead end. Operator mode, and a
 * render with no lens above it, are untouched.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LensLink } from "./LensLink";
import { FixedPresentationMode } from "./PresentationModeProvider";
import { lensLinkTarget } from "./presentationLinks";
import { PRESENTATION_READY_ROUTES } from "./presentationReadiness";

function renderLink(
  href: string,
  mode: "operator" | "presenting" | "no-lens"
): HTMLElement {
  const link = (
    <LensLink
      href={href}
      data-testid="lens-link"
      className="a-class"
      textClassName="text-class"
    >
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
  return screen.getByTestId("lens-link");
}

describe("LensLink — presenting", () => {
  it("links to a page that can be presented, carrying ?present=1", () => {
    const link = renderLink("/digital-twin", "presenting");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/digital-twin?present=1");
    expect(link).toHaveAttribute("data-lens-link", "linked");
    expect(link).toHaveClass("a-class");
    expect(link).toHaveTextContent("the label");
  });

  it("appends to a query the href already has", () => {
    expect(renderLink("/admin/coord?x=1", "presenting")).toHaveAttribute(
      "href",
      "/admin/coord?x=1&present=1"
    );
  });

  it("is plain text for a lens page not registered presentation-ready", () => {
    const text = renderLink("/admin/coord/work-units/a-plan", "presenting");
    expect(text.tagName).toBe("SPAN");
    expect(text).not.toHaveAttribute("href");
    expect(text).toHaveAttribute("data-lens-link", "unlinked");
    expect(text).toHaveClass("text-class");
    expect(text).not.toHaveClass("a-class");
    expect(text).toHaveTextContent("the label");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is plain text for a page out of the lens trees", () => {
    const text = renderLink("/sessions", "presenting");
    expect(text.tagName).toBe("SPAN");
    expect(text).toHaveAttribute("data-lens-link", "unlinked");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("LensLink — operator mode and no lens", () => {
  it("leaves every href alone in operator mode, ready or not", () => {
    for (const href of ["/admin/coord/work-units/a-plan", "/sessions"]) {
      const link = renderLink(href, "operator");
      expect(link.tagName, href).toBe("A");
      expect(link, href).toHaveAttribute("href", href);
      expect(link, href).toHaveAttribute("data-lens-link", "linked");
      expect(link, href).toHaveClass("a-class");
      cleanup();
    }
  });

  it("leaves an href alone where no lens is mounted above it", () => {
    const link = renderLink("/admin/coord/work-units/a-plan", "no-lens");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/admin/coord/work-units/a-plan");
  });
});

describe("lensLinkTarget — the decision, against a registry", () => {
  const withWorkUnits = [
    ...PRESENTATION_READY_ROUTES,
    { route: "/admin/coord/work-units/[slug]", provenBy: "a later phase" },
  ];

  it("links a page the day it is registered, and not before", () => {
    const href = "/admin/coord/work-units/a-plan";
    expect(lensLinkTarget(href, true)).toBeNull();
    expect(lensLinkTarget(href, true, withWorkUnits)).toBe(
      "/admin/coord/work-units/a-plan?present=1"
    );
  });

  it("never links out of the lens trees while presenting, whatever is registered", () => {
    const anywhere = [{ route: "/sessions", provenBy: "a mistake" }];
    expect(lensLinkTarget("/sessions", true, anywhere)).toBeNull();
    expect(lensLinkTarget("https://example.com/admin/coord", true)).toBeNull();
  });

  it("is the href itself in operator mode", () => {
    expect(lensLinkTarget("/sessions", false)).toBe("/sessions");
  });
});
