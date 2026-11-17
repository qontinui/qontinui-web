import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownView, isLocalImageSrc } from "./MarkdownView";

describe("isLocalImageSrc", () => {
  it("loads same-origin images only", () => {
    expect(isLocalImageSrc("/uploads/diagram.png")).toBe(true);
    expect(isLocalImageSrc("diagram.png")).toBe(true);
  });

  it("refuses anything that would reach another host", () => {
    expect(isLocalImageSrc("https://tracker.example/p.gif")).toBe(false);
    expect(isLocalImageSrc("//tracker.example/p.gif")).toBe(false);
    expect(isLocalImageSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isLocalImageSrc(undefined)).toBe(false);
  });
});

describe("MarkdownView tables", () => {
  it("gives a table its own horizontal scroll region", () => {
    // On a phone a many-column table would otherwise run off the page's edge,
    // which clips it with no way to reach the rest.
    const { container } = render(
      <MarkdownView>
        {"| Phase | Owner |\n| --- | --- |\n| One | Ann |"}
      </MarkdownView>
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
    expect(table?.textContent).toContain("Ann");
  });
});
