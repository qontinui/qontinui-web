/**
 * Unit tests for the style-gate snapshot normalizer (tests/e2e/style-gate/
 * normalize.ts). Pure functions, no Playwright — runs under vitest (`npm test`)
 * via the dedicated `tests/e2e/**\/*.test.ts` include in vitest.config.ts.
 */

import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  parseCssColor,
  parsePx,
  deriveInteractable,
  inertReason,
  parseOpacity,
  enrichElement,
  enrichElements,
  normalizeBboxes,
  projectMedia,
  srcDigest,
} from "./normalize";
// A REAL SDK capture, byte-identical to ui-bridge
// `packages/ui-bridge-python/tests/fixtures/sdk_find_media_response.json` at
// 7db24a78 (blob 4fe5d15244bfd5cb422724924202b74042a14a71): a `find` over an
// enveloped media row, with six unmeasured dimensions in its provenance.
import capturedFind from "./fixtures/sdk-find-media-response.json";

describe("parseCssColor", () => {
  it("parses rgb()", () => {
    expect(parseCssColor("rgb(255, 128, 0)")).toEqual({ r: 255, g: 128, b: 0 });
  });

  it("parses a fully opaque rgba() (alpha 1 IS opaque)", () => {
    expect(parseCssColor("rgba(16, 32, 48, 1)")).toEqual({
      r: 16,
      g: 32,
      b: 48,
    });
  });

  it("parses space-separated CSS Color 4 syntax when opaque", () => {
    expect(parseCssColor("rgb(10 20 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseCssColor("rgb(10 20 30 / 100%)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  // Partial alpha is OMITTED, never flattened: half-transparent black over a
  // white page is mid-grey, but flattened it reads as BLACK — and a contrast
  // check over the fabricated black can pass illegible light text. Both cases
  // below asserted the flattening until 2026-10-13.
  it("omits a partial alpha in rgba() instead of flattening it", () => {
    expect(parseCssColor("rgba(16, 32, 48, 0.5)")).toBeNull();
    expect(parseCssColor("rgba(0, 0, 0, 0.999)")).toBeNull();
  });

  it("omits a partial alpha in CSS Color 4 syntax instead of flattening it", () => {
    expect(parseCssColor("rgb(10 20 30 / 0.8)")).toBeNull();
    expect(parseCssColor("rgb(10 20 30 / 80%)")).toBeNull();
  });

  it("reads an unparseable alpha as unknown, not opaque", () => {
    expect(parseCssColor("rgba(0, 0, 0, 1.2.3)")).toBeNull();
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

  it("parses opaque #rrggbbaa / #rgba hex; null on any other alpha", () => {
    expect(parseCssColor("#102030ff")).toEqual({ r: 16, g: 32, b: 48 });
    expect(parseCssColor("#f80f")).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseCssColor("#10203040")).toBeNull(); // 25% — translucent
    expect(parseCssColor("#f80a")).toBeNull(); // ~67% — translucent
    expect(parseCssColor("#10203000")).toBeNull(); // fully transparent
  });

  it("never lets a translucent background reach bg_color", () => {
    const el: Record<string, unknown> = {
      id: "scrim-label",
      state: {
        computedStyles: {
          color: "rgb(250, 250, 250)",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
        },
      },
    };
    enrichElement(el);
    expect(el.bg_color).toBeUndefined();
    expect(el.fg_color).toEqual({ r: 250, g: 250, b: 250 });
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
    // SDK >= 0.27 projects each custom action as an object keyed by `id`.
    expect(deriveInteractable({ customActions: [{ id: "toggle" }] })).toBe(true);
    // A bare name (the pre-0.27 wire shape) still counts: the check reads
    // only that the list is non-empty.
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

describe("parseOpacity", () => {
  it("parses numeric and string opacities", () => {
    expect(parseOpacity(0)).toBe(0);
    expect(parseOpacity(1)).toBe(1);
    expect(parseOpacity("0")).toBe(0);
    expect(parseOpacity("0.5")).toBe(0.5);
    expect(parseOpacity(" 0 ")).toBe(0);
  });

  it("returns null (UNKNOWN) for unparseable values — NEVER 0", () => {
    // `Number("")` is 0; reading that as 0 would mark the element inert.
    expect(parseOpacity("")).toBeNull();
    expect(parseOpacity("   ")).toBeNull();
    expect(parseOpacity("inherit")).toBeNull();
    expect(parseOpacity("initial")).toBeNull();
    expect(parseOpacity(undefined)).toBeNull();
    expect(parseOpacity(null)).toBeNull();
    expect(parseOpacity({})).toBeNull();
    expect(parseOpacity(NaN)).toBeNull();
  });

  it("does not read a boolean as a number", () => {
    // Python guards `isinstance(v, bool)` explicitly; TS booleans are simply
    // not `typeof === "number"`, so `false` can never be read as 0.
    expect(parseOpacity(false)).toBeNull();
    expect(parseOpacity(true)).toBeNull();
  });
});

describe("inertReason", () => {
  it("names each PRESENT inert signal", () => {
    expect(inertReason({ state: { disabled: true } })).toBe("disabled");
    expect(inertReason({ state: { ariaDisabled: true } })).toBe(
      "aria-disabled"
    );
    expect(inertReason({ state: { enabled: false } })).toBe(
      "state.enabled=false"
    );
    expect(
      inertReason({ state: { computedStyles: { pointerEvents: "none" } } })
    ).toBe("pointer-events:none");
    expect(
      inertReason({ state: { computedStyles: { pointerEvents: "NONE " } } })
    ).toBe("pointer-events:none");
    expect(inertReason({ state: { opacityHidden: true } })).toBe("opacity:0");
    expect(inertReason({ state: { computedStyles: { opacity: "0" } } })).toBe(
      "opacity:0"
    );
    expect(inertReason({ state: { computedStyles: { opacity: 0 } } })).toBe(
      "opacity:0"
    );
  });

  it("returns null when the PRESENT signals all read live", () => {
    expect(
      inertReason({
        state: {
          disabled: false,
          ariaDisabled: false,
          enabled: true,
          opacityHidden: false,
          computedStyles: { pointerEvents: "auto", opacity: "1" },
        },
      })
    ).toBeNull();
  });

  it("ABSENT reads as UNKNOWN, never as inert", () => {
    expect(inertReason({})).toBeNull(); // no state at all
    expect(inertReason({ state: {} })).toBeNull(); // no computedStyles
    expect(inertReason({ state: { computedStyles: {} } })).toBeNull();
    // `pointerEvents: ""` is the SDK's own "could not read".
    expect(
      inertReason({ state: { computedStyles: { pointerEvents: "" } } })
    ).toBeNull();
    // An unparseable opacity is UNKNOWN, not 0.
    expect(
      inertReason({ state: { computedStyles: { opacity: "inherit" } } })
    ).toBeNull();
    // Absent `enabled` is UNKNOWN — `state.enabled === false`, not
    // `!state.enabled`.
    expect(inertReason({ state: { role: "button" } })).toBeNull();
    // A non-object `state` / `computedStyles` says nothing either.
    expect(inertReason({ state: "nope" })).toBeNull();
    expect(inertReason({ state: { computedStyles: "nope" } })).toBeNull();
  });
});

describe("deriveInteractable — the inert gate", () => {
  // The gate runs BEFORE tag/role/category: an element a user cannot hit is
  // not interactable however the SDK classifies it. Measured on a live
  // 112-element Terminal capture: interactable 96 -> 78, overlap 23 -> 14.
  it("suppresses a disabled element", () => {
    expect(
      deriveInteractable({ tagName: "button", state: { disabled: true } })
    ).toBe(false);
  });

  it("suppresses an aria-disabled element", () => {
    expect(
      deriveInteractable({ role: "button", state: { ariaDisabled: true } })
    ).toBe(false);
  });

  it("suppresses state.enabled === false", () => {
    expect(
      deriveInteractable({ tagName: "a", state: { enabled: false } })
    ).toBe(false);
  });

  it("suppresses pointer-events: none", () => {
    expect(
      deriveInteractable({
        tagName: "button",
        state: { computedStyles: { pointerEvents: "none" } },
      })
    ).toBe(false);
  });

  it("suppresses opacity 0 (computed, and the SDK's opacityHidden spelling)", () => {
    expect(
      deriveInteractable({
        tagName: "button",
        state: { computedStyles: { opacity: "0" } },
      })
    ).toBe(false);
    expect(
      deriveInteractable({ tagName: "button", state: { opacityHidden: true } })
    ).toBe(false);
  });

  it("beats category 'interactive' and a registered handler", () => {
    // The SDK marks a `pointer-events: none` button `interactive` all the
    // same — `category` says what the element IS, not whether it can be hit.
    expect(
      deriveInteractable({
        category: "interactive",
        state: { computedStyles: { pointerEvents: "none" } },
      })
    ).toBe(false);
    expect(
      deriveInteractable({
        actions: ["click"],
        state: { disabled: true },
      })
    ).toBe(false);
  });

  it("leaves a live control interactable", () => {
    expect(
      deriveInteractable({
        tagName: "button",
        state: {
          disabled: false,
          enabled: true,
          computedStyles: { pointerEvents: "auto", opacity: "1" },
        },
      })
    ).toBe(true);
  });

  // UNKNOWN negatives — a poorer producer must NOT be silently suppressed,
  // or the overlap pass empties and a broken page analyses clean.
  it("stays interactable when there is no state at all", () => {
    expect(deriveInteractable({ tagName: "button" })).toBe(true);
    expect(deriveInteractable({ category: "interactive" })).toBe(true);
  });

  it("stays interactable when there are no computedStyles", () => {
    expect(
      deriveInteractable({ tagName: "button", state: { role: "button" } })
    ).toBe(true);
    expect(
      deriveInteractable({ role: "link", state: { computedStyles: {} } })
    ).toBe(true);
  });

  it("stays interactable on an unparseable opacity", () => {
    expect(
      deriveInteractable({
        tagName: "button",
        state: { computedStyles: { opacity: "inherit" } },
      })
    ).toBe(true);
  });

  it("stays interactable on an empty pointerEvents (could not read)", () => {
    expect(
      deriveInteractable({
        tagName: "button",
        state: { computedStyles: { pointerEvents: "" } },
      })
    ).toBe(true);
  });

  it("an inert element still stays non-interactable for the ordinary reasons", () => {
    expect(
      deriveInteractable({ tagName: "div", state: { disabled: true } })
    ).toBe(false);
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

describe("enrichElement — stacking, visibility and text overflow", () => {
  // These five fields are what let the Rust analyzer answer "is anything
  // covering this?" and "was this label truncated?". Without them the layout
  // analyzer can see two boxes intersect but not which one the reader sees,
  // and text_fits_container compares only heights.

  it("never projects a CSS z-index into z_index", () => {
    // vision-core's `z_index` is a GLOBAL paint rank. A CSS z-index is
    // resolved inside its own stacking context: a `z-50` dropdown nested in a
    // `z-10` title bar paints BELOW a `z-20` sibling panel, so projecting the
    // CSS value inverts the occlusion verdict (coord finding 83b1e0d6). No
    // spelling of it — numeric, negative, zero, `auto` — may reach the field.
    for (const zIndex of ["30", "-1", "0", "auto", 5]) {
      const el: Record<string, unknown> = {
        id: "overlay",
        tagName: "div",
        state: { computedStyles: { zIndex } },
      };
      enrichElement(el);
      expect(el.z_index).toBeUndefined();
    }
  });

  it("carries the hit-test verdict and the occluder's identity", () => {
    const el: Record<string, unknown> = {
      id: "covered-label",
      tagName: "div",
      state: { visible: false, occludedBy: "terminal-zone-minimap" },
    };
    enrichElement(el);
    expect(el.visible).toBe(false);
    expect(el.occluded_by).toBe("terminal-zone-minimap");
  });

  it("emits scroll_width_px only when content actually exceeds the box", () => {
    const truncated: Record<string, unknown> = {
      id: "truncated",
      tagName: "span",
      state: {
        scrollWidth: 160,
        clientWidth: 80,
        computedStyles: { textOverflow: "ellipsis" },
      },
    };
    enrichElement(truncated);
    expect(truncated.scroll_width_px).toBe(160);
    expect(truncated.text_overflow).toBe("ellipsis");

    // Content that fits carries no information — and the Rust side reads
    // absence as "not measured", so writing equal values everywhere would
    // bloat every snapshot to say nothing.
    const fits: Record<string, unknown> = {
      id: "fits",
      tagName: "span",
      state: { scrollWidth: 40, clientWidth: 80 },
    };
    enrichElement(fits);
    expect(fits.scroll_width_px).toBeUndefined();
  });

  it("does not clobber fields a snapshot source already set", () => {
    const el: Record<string, unknown> = {
      id: "pre",
      tagName: "div",
      z_index: 99,
      visible: true,
      state: { visible: false, computedStyles: { zIndex: "1" } },
    };
    enrichElement(el);
    expect(el.z_index).toBe(99);
    expect(el.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Media — the vision-core `Element.media` record (plan
// 2026-10-13-image-generation-and-visual-judgment, Phase 7)
// ---------------------------------------------------------------------------

// THE shared `src_digest` vector: the same URL and digest are pinned in
// vision-core (`rust-vision-core/src/element_media.rs`), in the Python
// projector's suite (`scripts/test-uibridge-to-elementsnapshot.py`) and in
// ui-bridge-native's `vision-fields.test.ts`. The query is part of the input
// on purpose — stripped, every next/image is one image.
const SHARED_SRC =
  "http://localhost:3001/_next/image?url=%2Fimages%2Fhero.png&w=1920&q=75";
const SHARED_DIGEST =
  "a846bcf412cf708ec0a4ac6a972307cbcb250b75509765fd44c49caecbd01f94";

/** An SDK Observation envelope around one media fact record. */
function measured(
  value: Record<string, unknown>,
  unmeasured: string[] = []
): Record<string, unknown> {
  return {
    status: "measured",
    value,
    provenance: {
      producer: { id: "sdk/media-discovery", version: "0.31.0" },
      observedAt: "2026-10-13T08:12:27.592Z",
      evaluatedAt: "2026-10-13T08:12:27.592Z",
      coverage: {
        considered: 1,
        measured: unmeasured.length ? 0 : 1,
        unmeasured: unmeasured.map((dimension) => ({
          dimension,
          count: 1,
          code: "input_missing",
        })),
      },
      confidence: null,
      cache: null,
      source: null,
    },
  };
}

/** A snapshot row the way the SDK serializes one. */
function mediaRow(
  mediaMetadata: unknown,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const { state: stateOverride, ...rest } = overrides;
  return {
    id: "img",
    tagName: "img",
    category: "media",
    accessibleName: "Alt text that is NOT painted",
    ...(mediaMetadata === undefined ? {} : { mediaMetadata }),
    state: {
      inViewport: true,
      textContent: "",
      ...((stateOverride as Record<string, unknown> | undefined) ?? {}),
    },
    ...rest,
  };
}

const IMAGE_FACTS: Record<string, unknown> = {
  mediaType: "image",
  isDecorative: false,
  renderedWidth: 100,
  renderedHeight: 50,
  src: SHARED_SRC,
  altText: "Hero",
  naturalWidth: 400,
  naturalHeight: 200,
  effectiveResolution: 2,
  objectFit: "cover",
  objectPosition: "50% 50%",
  dimsReserved: true,
  loading: "eager",
  decoding: "async",
  fetchPriority: "high",
  loadingState: "loaded",
  format: "webp",
  encodedBodySize: 48213,
  isLcpCandidate: true,
  clsSources: [
    {
      value: 0.25,
      startTime: 10,
      hadRecentInput: false,
      previousRect: { x: 0, y: 0, width: 1, height: 1 },
      currentRect: { x: 0, y: 9, width: 1, height: 1 },
    },
    {
      value: 0.5,
      startTime: 20,
      hadRecentInput: true,
      previousRect: { x: 0, y: 0, width: 1, height: 1 },
      currentRect: { x: 0, y: 9, width: 1, height: 1 },
    },
  ],
  slotId: "hero",
};

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** `projectMedia`'s result, asserted non-null. */
function mediaOf(row: Record<string, unknown>) {
  const media = projectMedia(row);
  if (!media) throw new Error(`expected a media record for ${String(row.id)}`);
  return media;
}

describe("srcDigest — the shared vector", () => {
  it("matches the digest vision-core and the other converters pin", () => {
    expect(srcDigest(SHARED_SRC)).toBe(SHARED_DIGEST);
  });

  it("keeps the query: a stripped next/image URL digests differently", () => {
    expect(srcDigest(SHARED_SRC.slice(0, SHARED_SRC.indexOf("?")))).not.toBe(
      SHARED_DIGEST
    );
    expect(srcDigest(SHARED_SRC.replace("hero.png", "logo.png"))).not.toBe(
      SHARED_DIGEST
    );
  });
});

describe("projectMedia — enveloped SDK observations", () => {
  it("projects the REAL captured find row, omitting its unmeasured dimensions", () => {
    const rows = (capturedFind as { elements: Array<Record<string, unknown>> })
      .elements;
    const row = structuredClone(rows[0]);
    if (!row) throw new Error("the captured find response carries no row");
    enrichElement(row);
    expect(row.media).toEqual({
      kind: "img",
      in_viewport: true,
      natural_px: { w: 400, h: 400 },
      rendered_px: { w: 100, h: 100 },
      src_digest: sha256("http://localhost:3000/img/hero.png"),
      effective_resolution: 2,
      loading: "lazy",
      decoding: "auto",
      fetch_priority: "auto",
      load_state: "loaded",
      dims_reserved: true,
      format: "png",
      alt: { decorative: false, text: "Hero" },
      slot_id: "hero",
      placeholder: false,
    });
    // Its accessibleName is the alt: never the element's text.
    expect(row.text).toBeUndefined();
  });

  it("projects every field of a full record, CLS excluding shifts after input", () => {
    const media = mediaOf(mediaRow(measured(IMAGE_FACTS)));
    expect(media.object_fit).toBe("cover");
    expect(media.object_position).toBe("50% 50%");
    expect(media.transfer_bytes).toBe(48213); // encodedBodySize, not transferSize
    expect(media.is_lcp_candidate).toBe(true);
    expect(media.cls_contribution).toBe(0.25);
    expect(media.src_digest).toBe(SHARED_DIGEST);
  });

  it("omits an unmeasured dimension even when a value rode along", () => {
    const media = mediaOf(
      mediaRow(measured(IMAGE_FACTS, ["objectFit", "encodedBodySize", "clsSources"]))
    );
    expect(media.object_fit).toBeUndefined();
    expect(media.transfer_bytes).toBeUndefined();
    expect(media.cls_contribution).toBeUndefined();
  });

  it("records a MISSING alt as measured, and an unread one as absent", () => {
    const noAlt = { ...IMAGE_FACTS };
    delete noAlt.altText;
    expect(mediaOf(mediaRow(measured(noAlt))).alt).toEqual({ decorative: false });
    expect(mediaOf(mediaRow(measured(IMAGE_FACTS, ["altText"]))).alt).toBeUndefined();
  });

  it("reads [] clsSources as a measured zero and a placeholder marker as true", () => {
    expect(
      mediaOf(mediaRow(measured({ ...IMAGE_FACTS, clsSources: [] }))).cls_contribution
    ).toBe(0);
    expect(
      mediaOf(mediaRow(measured({ ...IMAGE_FACTS, placeholder: true }))).placeholder
    ).toBe(true);
  });

  it("never digests a redacted src, and never takes the sentinel as alt or slot", () => {
    const media = mediaOf(
      mediaRow(
        measured({
          ...IMAGE_FACTS,
          src: "[REDACTED]",
          altText: "[REDACTED]",
          slotId: "[REDACTED]",
        }),
        { state: { redaction: { content: true } } }
      )
    );
    expect(media.src_digest).toBeUndefined();
    expect(media.alt).toBeUndefined();
    expect(media.slot_id).toBeUndefined();
    expect(media.natural_px).toEqual({ w: 400, h: 200 }); // structure survives
  });

  it("keeps an image whose capture failed as an image with no facts", () => {
    const unknown = {
      status: "unknown",
      unknown: { code: "producer_failed", detail: "media capture threw TypeError" },
      provenance: measured({}).provenance,
    };
    expect(projectMedia(mediaRow(unknown))).toEqual({
      kind: "img",
      in_viewport: true,
    });
    // An untyped div cannot be named: no media rather than a guessed kind.
    expect(projectMedia(mediaRow(unknown, { tagName: "div" }))).toBeNull();
  });

  it("emits nothing envelope-shaped on a scalar field", () => {
    // An object on a scalar `ElementMedia` field rejects the WHOLE snapshot.
    const media = mediaOf(mediaRow(measured(IMAGE_FACTS)));
    const nested = new Set(["natural_px", "rendered_px", "alt"]);
    const stray = Object.entries(media)
      .filter(([k, v]) => typeof v === "object" && v !== null && !nested.has(k))
      .map(([k]) => k);
    expect(stray).toEqual([]);
  });

  it("projects nothing for a non-media row", () => {
    expect(projectMedia({ id: "btn", tagName: "button", state: {} })).toBeNull();
  });
});

describe("projectMedia — the legacy (pre-envelope) shape", () => {
  const legacy: Record<string, unknown> = {
    mediaType: "image",
    src: "/img/a.png",
    isDecorative: false,
    altText: "A",
    naturalWidth: 800,
    naturalHeight: 600,
    renderedWidth: 200,
    renderedHeight: 150,
    oversizeRatio: 4,
    loadingState: "loaded",
    lazyLoading: true,
    format: "png",
    transferSize: 0,
  };

  it("projects the fields that mean the same thing, and only those", () => {
    // oversizeRatio is DPR-blind and transferSize reads 0 on every cache hit:
    // neither is effective_resolution or transfer_bytes.
    expect(projectMedia(mediaRow(legacy))).toEqual({
      kind: "img",
      in_viewport: true,
      natural_px: { w: 800, h: 600 },
      rendered_px: { w: 200, h: 150 },
      src_digest: sha256("/img/a.png"),
      loading: "lazy",
      load_state: "loaded",
      format: "png",
      alt: { decorative: false, text: "A" },
    });
  });

  it("does not trust a legacy isDecorative on an alt-less image", () => {
    // Legacy `isDecorative` is `img.alt === ''`: a MISSING alt reads decorative.
    const noAlt: Record<string, unknown> = { ...legacy, isDecorative: true };
    delete noAlt.altText;
    expect(mediaOf(mediaRow(noAlt)).alt).toBeUndefined();
  });

  it("does not trust a legacy background's hardcoded load state", () => {
    const bg = {
      mediaType: "background-image",
      src: "/bg.png",
      isDecorative: true,
      renderedWidth: 10,
      renderedHeight: 10,
      loadingState: "loaded",
      lazyLoading: false,
    };
    const media = mediaOf(mediaRow(bg, { tagName: "section" }));
    expect(media.kind).toBe("css_background");
    expect(media.load_state).toBeUndefined();
  });

  it("does not trust a format inferred from a transcoder URL", () => {
    expect(
      mediaOf(mediaRow({ ...legacy, src: "/_next/image?w=64&url=/a.png", format: "png" }))
        .format
    ).toBeUndefined();
  });

  it("reads state.mediaMetadata when no top-level copy exists", () => {
    const row = mediaRow(undefined, { state: { mediaMetadata: legacy } });
    expect(mediaOf(row).kind).toBe("img");
  });
});

describe("enrichElement — media kinds and the painted-text rule", () => {
  const cases: Array<[string, string, string]> = [
    ["picture", "picture", "picture"],
    ["img", "picture", "picture"],
    ["svg", "svg", "svg"],
    ["video", "video", "video"],
    ["canvas", "canvas", "canvas"],
    ["div", "image", "role_img"],
    ["section", "background-image", "css_background"],
  ];
  for (const [tagName, mediaType, kind] of cases) {
    it(`a ${tagName}/${mediaType} row is ${kind}, with painted text only`, () => {
      const el = mediaRow(
        measured({ mediaType, isDecorative: false, renderedWidth: 1, renderedHeight: 1 }),
        { tagName, state: { textContent: "painted or not" } }
      );
      enrichElement(el);
      expect((el.media as Record<string, unknown>).kind).toBe(kind);
      const painted = kind === "role_img" || kind === "css_background";
      expect(el.text).toBe(painted ? "painted or not" : undefined);
    });
  }

  it("removes text a source put on an unpainted media row", () => {
    // Whatever sits there is fallback content or an SVG <title> — an alt.
    const el = mediaRow(measured(IMAGE_FACTS), { text: "Hero" });
    enrichElement(el);
    expect(el.text).toBeUndefined();
    expect((el.media as Record<string, unknown>).alt).toEqual({
      decorative: false,
      text: "Hero",
    });
  });

  it("does not clobber a media record a snapshot source already set", () => {
    const el = mediaRow(measured(IMAGE_FACTS), { media: { kind: "video" } });
    enrichElement(el);
    expect(el.media).toEqual({ kind: "video" });
  });
});
