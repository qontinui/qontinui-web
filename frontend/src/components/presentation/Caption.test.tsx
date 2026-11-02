/**
 * Caption (plan `2026-10-23-console-presentation-spaces` D1, D5): captions are
 * presentation chrome — absent in operator mode unless the caption IS the
 * page title — and their product terms explain themselves through
 * GlossaryTerm.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Caption } from "./Caption";
import { CAPTIONS, captionSegments } from "./captions";
import { FixedPresentationMode } from "./PresentationModeProvider";

const DEV_OPS = CAPTIONS["dev-ops.page"];

function oneLinerText(): string {
  return captionSegments(DEV_OPS.oneLiner)
    .map((s) => (typeof s === "string" ? s : (s.text ?? "")))
    .join("");
}

describe("Caption", () => {
  it("renders nothing in operator mode — the console's chrome stays one line", () => {
    const { container } = render(
      <FixedPresentationMode presenting={false}>
        <Caption id="dev-ops.page" />
      </FixedPresentationMode>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing where no lens is mounted", () => {
    const { container } = render(<Caption id="dev-ops.page" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the title, the one-liner and why it matters in presentation mode", () => {
    render(
      <FixedPresentationMode presenting>
        <Caption id="dev-ops.page" />
      </FixedPresentationMode>
    );
    const caption = document.querySelector(
      '[data-presentation-caption="dev-ops.page"]'
    );
    expect(caption).not.toBeNull();
    expect(caption).toHaveAttribute("data-caption-mode", "presentation");
    expect(
      screen.getByRole("heading", { level: 2, name: DEV_OPS.title })
    ).toBeInTheDocument();
    expect(
      caption?.querySelector('[data-caption-part="one-liner"]')
    ).toHaveTextContent(oneLinerText());
    expect(
      caption?.querySelector('[data-caption-part="why-it-matters"]')
    ).not.toBeNull();
  });

  it("renders each product term through GlossaryTerm", () => {
    render(
      <FixedPresentationMode presenting>
        <Caption id="coordination-overview.page" />
      </FixedPresentationMode>
    );
    const terms = [...document.querySelectorAll("[data-glossary-term]")].map(
      (el) => el.getAttribute("data-glossary-term")
    );
    // The coordination-overview copy names the operator, the coordination
    // service and what it keeps consistent.
    expect(terms).toEqual(
      expect.arrayContaining([
        "operator",
        "coord",
        "claim",
        "work_unit",
        "gate",
      ])
    );
    expect(screen.getByText("coordination service")).toHaveAttribute(
      "data-glossary-term",
      "coord"
    );
  });

  it("keeps a persistent caption's title and one-liner in operator mode, and only those", () => {
    render(
      <FixedPresentationMode presenting={false}>
        <Caption id="digital-twin.page" level={1} persistent />
      </FixedPresentationMode>
    );
    // The twin page's Spec CI contract: a heading reading exactly "Digital Twin".
    expect(
      screen.getByRole("heading", { level: 1, name: "Digital Twin" })
    ).toBeInTheDocument();
    const caption = document.querySelector(
      '[data-presentation-caption="digital-twin.page"]'
    );
    expect(caption).toHaveAttribute("data-caption-mode", "operator");
    expect(
      caption?.querySelector('[data-caption-part="one-liner"]')
    ).not.toBeNull();
    expect(
      caption?.querySelector('[data-caption-part="why-it-matters"]')
    ).toBeNull();
  });

  it("adds why it matters to a persistent caption in presentation mode", () => {
    render(
      <FixedPresentationMode presenting>
        <Caption id="digital-twin.page" level={1} persistent />
      </FixedPresentationMode>
    );
    expect(
      document.querySelector('[data-caption-part="why-it-matters"]')
    ).not.toBeNull();
  });

  it("renders an untitled caption's sentences without its title, whose words are already on screen", () => {
    render(
      <FixedPresentationMode presenting>
        <Caption id="tour.start" untitled persistent />
      </FixedPresentationMode>
    );
    const caption = document.querySelector(
      '[data-presentation-caption="tour.start"]'
    );
    expect(caption?.querySelector("h1, h2, h3")).toBeNull();
    expect(caption).not.toHaveTextContent(CAPTIONS["tour.start"].title);
    expect(
      caption?.querySelector('[data-caption-part="one-liner"]')
    ).not.toBeNull();
    expect(
      caption?.querySelector('[data-caption-part="why-it-matters"]')
    ).not.toBeNull();
  });

  it("renders a brief caption's title and one-liner only, even in presentation mode", () => {
    render(
      <FixedPresentationMode presenting>
        <Caption id="dev-ops.page" level={1} brief />
      </FixedPresentationMode>
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Dev Ops" })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-caption-part="one-liner"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-caption-part="why-it-matters"]')
    ).toBeNull();
  });
});
