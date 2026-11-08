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

/**
 * Every kind of code a document can hold that is NOT a live block: a bare
 * fence, a fence in a language, one with an info string, near-misses of the
 * block prefixes, an indented block, and inline code. The snapshot was
 * recorded from `MarkdownView` before it learned to render blocks (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` Phase
 * 2), so it pins that every one of them still renders exactly as it did.
 */
const NON_BLOCK_CODE = [
  "# Notes",
  "",
  "```",
  "a bare fence",
  "```",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  '```js title="example"',
  "console.log(1);",
  "```",
  "",
  "```mermaid",
  "gantt",
  "  title Plan",
  "```",
  "",
  "```reports-timeline",
  "not a block: the prefix is report-, not reports-",
  "```",
  "",
  "```overviewkpi forecast-finish",
  "not a block either",
  "```",
  "",
  "    an indented block",
  "",
  "Inline `code` stays inline.",
].join("\n");

describe("MarkdownView code that is not a block", () => {
  it("renders exactly as it did before blocks existed", () => {
    const { container } = render(<MarkdownView>{NON_BLOCK_CODE}</MarkdownView>);
    expect(container.innerHTML).toMatchSnapshot("non-block code");
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
