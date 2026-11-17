/**
 * jsdom has no layout, so this pins the class that does the work; the width it
 * produces is checked in a browser at phone width.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ScrollArea } from "./scroll-area";

function viewportOf(container: HTMLElement) {
  const viewport = container.querySelector(
    '[data-slot="scroll-area-viewport"]'
  );
  if (!viewport) throw new Error("no viewport rendered");
  return viewport;
}

describe("ScrollArea", () => {
  it("leaves Radix's table wrapper alone by default", () => {
    const { container } = render(<ScrollArea>content</ScrollArea>);
    expect(viewportOf(container).className).not.toContain("[&>div]:!block");
  });

  it("with fitWidth, overrides the wrapper that Radix styles display: table", () => {
    const { container } = render(<ScrollArea fitWidth>content</ScrollArea>);
    const viewport = viewportOf(container);
    expect(viewport.className).toContain("[&>div]:!block");
    // The inline style the class has to beat: if a Radix upgrade drops this
    // wrapper, the selector above stops matching anything.
    expect((viewport.firstElementChild as HTMLElement).style.display).toBe(
      "table"
    );
  });
});
