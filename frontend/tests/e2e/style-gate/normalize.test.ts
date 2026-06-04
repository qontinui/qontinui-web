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
      false,
    );
    expect(deriveInteractable({ tagName: "span", actions: [] })).toBe(false);
    expect(deriveInteractable({ tagName: "p" })).toBe(false);
    expect(deriveInteractable({})).toBe(false);
  });
  it("is FALSE for media without handlers", () => {
    expect(deriveInteractable({ category: "media", tagName: "img" })).toBe(
      false,
    );
  });
  it("a content element with a real handler is still interactable", () => {
    expect(
      deriveInteractable({ category: "content", actions: ["click"] }),
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
