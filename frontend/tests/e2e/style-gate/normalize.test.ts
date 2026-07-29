/**
 * Unit tests for the style-gate snapshot normalizer (tests/e2e/style-gate/
 * normalize.ts). Pure functions, no Playwright — runs under vitest (`npm test`)
 * via the dedicated `tests/e2e/**\/*.test.ts` include in vitest.config.ts.
 */

import { describe, it, expect } from "vitest";
import {
  parseCssColor,
  parsePx,
  deriveInteractable,
  enrichElement,
  enrichElements,
  normalizeBboxes,
} from "./normalize";

describe("parseCssColor", () => {
  it("parses rgb()", () => {
    expect(parseCssColor("rgb(255, 128, 0)")).toEqual({ r: 255, g: 128, b: 0 });
  });

  it("parses rgba() and drops alpha", () => {
    expect(parseCssColor("rgba(16, 32, 48, 0.5)")).toEqual({
      r: 16,
      g: 32,
      b: 48,
    });
  });

  it("parses space-separated CSS Color 4 syntax", () => {
    expect(parseCssColor("rgb(10 20 30 / 0.8)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  it("returns null for fully transparent (alpha 0)", () => {
    expect(parseCssColor("rgba(0,0,0,0)")).toBeNull();
    expect(parseCssColor("rgb(0 0 0 / 0%)")).toBeNull();
  });

  it("returns null for transparent / none / currentColor / empty", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("none")).toBeNull();
    expect(parseCssColor("currentColor")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
    expect(parseCssColor(123)).toBeNull();
  });

  it("parses #rrggbb and #rgb hex", () => {
    expect(parseCssColor("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseCssColor("#f80")).toEqual({ r: 255, g: 136, b: 0 });
  });

  it("parses #rrggbbaa hex and drops alpha; null on alpha 0", () => {
    expect(parseCssColor("#10203040")).toEqual({ r: 16, g: 32, b: 48 });
    expect(parseCssColor("#10203000")).toBeNull();
  });

  it("returns null for unparseable", () => {
    expect(parseCssColor("not-a-color")).toBeNull();
    expect(parseCssColor("hsl(0,0%,0%)")).toBeNull();
  });
});

describe("parsePx", () => {
  it("parses px strings", () => {
    expect(parsePx("16px")).toBe(16);
    expect(parsePx("13.5px")).toBe(13.5);
  });
  it("parses bare numbers / numeric strings", () => {
    expect(parsePx(20)).toBe(20);
    expect(parsePx("20")).toBe(20);
  });
  it("returns null for normal/auto/empty and non-px units", () => {
    expect(parsePx("normal")).toBeNull();
    expect(parsePx("auto")).toBeNull();
    expect(parsePx("")).toBeNull();
    expect(parsePx("1.5em")).toBeNull();
    expect(parsePx("50%")).toBeNull();
    expect(parsePx(undefined)).toBeNull();
    expect(parsePx(NaN)).toBeNull();
  });
});

describe("deriveInteractable", () => {
  it("is true for category interactive", () => {
    expect(deriveInteractable({ category: "interactive" })).toBe(true);
  });
  it("is true for a non-empty actions array", () => {
    expect(deriveInteractable({ actions: ["click"] })).toBe(true);
  });
  it("is true for customActions", () => {
    expect(deriveInteractable({ customActions: ["toggle"] })).toBe(true);
  });
  it("is true for interactive tag", () => {
    expect(deriveInteractable({ tagName: "BUTTON" })).toBe(true);
    expect(deriveInteractable({ tagName: "a" })).toBe(true);
  });
  it("is true for interactive ARIA role (on element or state)", () => {
    expect(deriveInteractable({ role: "link" })).toBe(true);
    expect(deriveInteractable({ state: { role: "tab" } })).toBe(true);
  });
  it("is FALSE for plain content / containers", () => {
    expect(deriveInteractable({ category: "content", tagName: "div" })).toBe(
      false
    );
    expect(deriveInteractable({ tagName: "span", actions: [] })).toBe(false);
    expect(deriveInteractable({ tagName: "p" })).toBe(false);
    expect(deriveInteractable({})).toBe(false);
  });
  it("is FALSE for media without handlers", () => {
    expect(deriveInteractable({ category: "media", tagName: "img" })).toBe(
      false
    );
  });
  it("a content element with a real handler is still interactable", () => {
    expect(
      deriveInteractable({ category: "content", actions: ["click"] })
    ).toBe(true);
  });
});

describe("enrichElement", () => {
  it("maps a typical interactive button element", () => {
    const el: Record<string, unknown> = {
      id: "btn-1",
      tagName: "button",
      actions: ["click"],
      text: "Save",
      role: "button",
      state: {
        textContent: "Save",
        role: "button",
        computedStyles: {
          color: "rgb(255, 255, 255)",
          backgroundColor: "#2563eb",
          fontSize: "14px",
          lineHeight: "20px",
        },
      },
    };
    enrichElement(el);
    expect(el.interactable).toBe(true);
    expect(el.fg_color).toEqual({ r: 255, g: 255, b: 255 });
    expect(el.bg_color).toEqual({ r: 37, g: 99, b: 235 });
    expect(el.font_size_px).toBe(14);
    expect(el.line_height_px).toBe(20);
    expect(el.text).toBe("Save");
    expect(el.role).toBe("button");
    // font_family absent in computedStyles -> omitted.
    expect(el.font_family).toBeUndefined();
  });

  it("derives text from state.textContent when el.text is empty", () => {
    const el: Record<string, unknown> = {
      id: "x",
      tagName: "div",
      text: "",
      state: { textContent: "  Hello  " },
    };
    enrichElement(el);
    expect(el.text).toBe("Hello");
    expect(el.interactable).toBe(false);
  });

  it("omits color/typography when computedStyles missing or transparent", () => {
    const el: Record<string, unknown> = {
      id: "c",
      tagName: "div",
      state: {
        computedStyles: {
          color: "transparent",
          backgroundColor: "rgba(0,0,0,0)",
          fontSize: "normal",
          lineHeight: "normal",
        },
      },
    };
    enrichElement(el);
    expect(el.fg_color).toBeUndefined();
    expect(el.bg_color).toBeUndefined();
    expect(el.font_size_px).toBeUndefined();
    expect(el.line_height_px).toBeUndefined();
  });

  it("reads font_family defensively if a future SDK provides it", () => {
    const el: Record<string, unknown> = {
      id: "f",
      state: { computedStyles: { fontFamily: "Inter, sans-serif" } },
    };
    enrichElement(el);
    expect(el.font_family).toBe("Inter, sans-serif");
  });

  it("does not overwrite pre-existing analyzer-shaped fields", () => {
    const el: Record<string, unknown> = {
      id: "p",
      tagName: "button",
      interactable: false, // a source already declared it non-interactive
      fg_color: { r: 1, g: 2, b: 3 },
      state: { computedStyles: { color: "rgb(9,9,9)" } },
    };
    enrichElement(el);
    expect(el.interactable).toBe(false);
    expect(el.fg_color).toEqual({ r: 1, g: 2, b: 3 });
  });

  it("does not set absent fields (omitted, not guessed)", () => {
    const el: Record<string, unknown> = { id: "bare" };
    enrichElement(el);
    expect(el).toEqual({ id: "bare", interactable: false });
  });
});

describe("enrichElements", () => {
  it("enriches each object and skips non-objects", () => {
    const els: unknown[] = [
      { id: "a", tagName: "button" },
      null,
      "nope",
      { id: "b", tagName: "p" },
    ];
    enrichElements(els);
    expect((els[0] as Record<string, unknown>).interactable).toBe(true);
    expect((els[3] as Record<string, unknown>).interactable).toBe(false);
    expect(els[1]).toBeNull();
    expect(els[2]).toBe("nope");
  });
});

describe("normalizeBboxes", () => {
  const bboxOf = (el: unknown) =>
    (el as Record<string, unknown>).bbox as Record<string, number> | undefined;

  it("maps {x,y,width,height} floats to the Rust Region {x,y,w,h}", () => {
    const els: unknown[] = [
      { id: "a", bbox: { x: 10.4, y: 20.6, width: 100.5, height: 40.2 } },
    ];
    normalizeBboxes(els);
    expect(bboxOf(els[0])).toEqual({ x: 10, y: 21, w: 101, h: 40 });
  });

  // ---------------------------------------------------------------------
  // Signed origin. `Region.x`/`Region.y` are i32 in rust-vision-core, so the
  // capture emits the TRUE coordinate. Clamping negatives to 0 (what this
  // adapter used to do) reported every off-viewport element as sitting flush
  // against the viewport edge — fabricating overlaps against whatever really
  // lives at the origin and erasing genuine off-screen placement.
  // ---------------------------------------------------------------------

  it("preserves a negative x/y instead of clamping it to 0", () => {
    // A `left: -9999px` screen-reader-only node, and a sticky header
    // scrolled half off the top of the viewport.
    const els: unknown[] = [
      { id: "sr-only", bbox: { x: -9999, y: 12, width: 120, height: 32 } },
      { id: "sticky-header", bbox: { x: 0, y: -23.6, width: 800, height: 48 } },
    ];
    normalizeBboxes(els);
    expect(bboxOf(els[0])).toEqual({ x: -9999, y: 12, w: 120, h: 32 });
    expect(bboxOf(els[1])).toEqual({ x: 0, y: -24, w: 800, h: 48 });
  });

  it("rounds negative origins to the nearest integer, not toward zero", () => {
    const els: unknown[] = [
      { id: "a", bbox: { x: -0.4, y: -0.6, width: 1, height: 1 } },
    ];
    normalizeBboxes(els);
    // Math.round(-0.4) === -0 and Math.round(-0.6) === -1; -0 serializes as 0.
    const b = bboxOf(els[0])!;
    expect(b.x === 0 || Object.is(b.x, -0)).toBe(true);
    expect(b.y).toBe(-1);
  });

  it("still floors a negative width/height at 0 (unsigned extent)", () => {
    const els: unknown[] = [
      { id: "a", bbox: { x: -5, y: -5, width: -3, height: -7 } },
    ];
    normalizeBboxes(els);
    expect(bboxOf(els[0])).toEqual({ x: -5, y: -5, w: 0, h: 0 });
  });

  it("negative coordinates survive JSON serialization verbatim", () => {
    // The capture writes `JSON.stringify(body)` to disk for `vision-audit`
    // to deserialize — this is the wire the analyzer actually reads.
    const els: unknown[] = [
      { id: "off", bbox: { x: -9999, y: -48, width: 120, height: 32 } },
    ];
    normalizeBboxes(els);
    const round = JSON.parse(JSON.stringify({ elements: els })) as {
      elements: Array<{ bbox: Record<string, number> }>;
    };
    expect(round.elements[0].bbox).toEqual({ x: -9999, y: -48, w: 120, h: 32 });
  });

  it("drops a malformed or non-finite bbox rather than emitting NaN", () => {
    const els: unknown[] = [
      { id: "a", bbox: { x: NaN, y: 0, width: 1, height: 1 } },
      { id: "b", bbox: { x: 0, y: 0, width: 1 } },
      { id: "c", bbox: "nope" },
      { id: "d", bbox: null },
    ];
    normalizeBboxes(els);
    for (const el of els) {
      expect("bbox" in (el as Record<string, unknown>)).toBe(false);
    }
  });

  it("leaves bbox-less elements and non-objects untouched", () => {
    const els: unknown[] = [{ id: "a" }, null, "nope"];
    normalizeBboxes(els);
    expect(els[0]).toEqual({ id: "a" });
    expect(els[1]).toBeNull();
    expect(els[2]).toBe("nope");
  });
});
