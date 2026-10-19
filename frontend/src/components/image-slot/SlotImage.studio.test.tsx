/**
 * Round trip: what qontinui-studio WRITES is what `<SlotImage>` renders.
 *
 * Every fixture under `test-fixtures/image-slots/studio/<case>/` was written
 * by studio itself, not by hand: the `studio-manifest.json` its compile step
 * published and the slot spec it compiled, dumped from qontinui-studio's own
 * `tests/test_compile.py` at branch head 64f0006f (Phase 19's `studio
 * compile`):
 *
 * | case                   | studio test                                                    |
 * | ---------------------- | -------------------------------------------------------------- |
 * | diffusion              | test_a_missing_slot_compiles_into_the_checkout                 |
 * | diffusion-alt-required | test_an_alt_required_slot_waits_for_its_alt_text_then_publishes |
 * | traced                 | test_a_traced_slot_lands_as_a_marked_svg                       |
 * | og-card                | test_an_og_card_is_one_png_checked_by_fetch                    |
 *
 * EXCEPT `authored-svg/onboarding.connect.svg`, which is HAND-WRITTEN, not
 * studio output: studio writes no file for an authored SVG (its `svg` route
 * only validates what the session writes). It is shaped to studio's contract
 * (`compiler/selected.py`) and current for the spec beside it, which studio's
 * `test_an_svg_slot_is_authored_by_the_session_and_validated` wrote. It is
 * compiled here exactly as `npm run image-slots:generate` compiles one
 * (`compileAuthoredSvg`, the SVG allowlist and re-serialisation).
 *
 * Re-dump them when studio's manifest shape changes, so this test keeps
 * reading what studio actually writes.
 */

import fs from "fs";
import path from "path";
import { render } from "@testing-library/react";
import { parse } from "yaml";
import type { ImageSlotSpec } from "@qontinui/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compileAuthoredSvg } from "@/lib/image-slots/codegen";
import {
  readStudioManifest,
  type AuthoredSvg,
  type ManifestRead,
  type StudioManifest,
} from "@/lib/image-slots/manifest";
import { SlotImage } from "./SlotImage";

const FIXTURES = path.resolve(
  __dirname,
  "../../../test-fixtures/image-slots/studio"
);

const state = vi.hoisted(() => ({
  manifest: null as ManifestRead | null,
  spec: null as ImageSlotSpec | null,
  svg: undefined as AuthoredSvg | undefined,
}));
vi.mock("@/lib/image-slots/manifest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/image-slots/manifest")>();
  return {
    ...actual,
    get SLOT_MANIFEST() {
      return state.manifest ?? actual.SLOT_MANIFEST;
    },
  };
});
vi.mock("@/lib/image-slots/specs.generated", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/image-slots/specs.generated")>();
  return {
    ...actual,
    imageSlotSpec: () => state.spec,
    imageSlotAuthoredSvg: () => state.svg,
  };
});

function load(caseName: string, slot: string): StudioManifest | null {
  const dir = path.join(FIXTURES, caseName);
  state.spec = parse(fs.readFileSync(path.join(dir, `${slot}.yaml`), "utf8"), {
    version: "1.2",
  }) as ImageSlotSpec;
  const svg = path.join(dir, `${slot}.svg`);
  state.svg = fs.existsSync(svg)
    ? compileAuthoredSvg(
        `${slot}.svg`,
        fs.readFileSync(svg, "utf8"),
        state.spec as unknown as Record<string, unknown>,
        (text) => new DOMParser().parseFromString(text, "image/svg+xml")
      )
    : undefined;
  const manifestPath = path.join(dir, "studio-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    state.manifest = {
      ok: true,
      manifest: { generated_by: "qontinui-studio", slots: {} },
    };
    return null;
  }
  const read = readStudioManifest(
    JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  );
  expect(read.ok).toBe(true);
  state.manifest = read;
  return read.ok ? read.manifest : null;
}

function renderSlot(slot: string) {
  // The fixture slots are studio's, not this app's declared ids.
  const { container } = render(<SlotImage slot={slot as never} />);
  return container.firstElementChild as HTMLElement;
}

function sources(el: HTMLElement) {
  return [...el.querySelectorAll("source")].map((s) => [
    s.getAttribute("type"),
    s.getAttribute("srcset"),
  ]);
}

const sha = (m: StudioManifest | null, slot: string, format: string) =>
  m?.slots[slot]?.sha256[format];

beforeEach(() => {
  state.manifest = null;
  state.spec = null;
  state.svg = undefined;
});

describe("<SlotImage> renders what studio compile wrote", () => {
  it("a diffusion slot: AVIF and WebP sources over a PNG <img>, decorative alt", () => {
    const slot = "marketing.home.hero";
    const m = load("diffusion", slot);
    const el = renderSlot(slot);
    expect(el.tagName).toBe("PICTURE");
    expect(sources(el)).toEqual([
      ["image/avif", `/image-slots/${slot}.avif?sha=${sha(m, slot, "avif")}`],
      ["image/webp", `/image-slots/${slot}.webp?sha=${sha(m, slot, "webp")}`],
    ]);
    const img = el.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      `/image-slots/${slot}.png?sha=${sha(m, slot, "png")}`
    );
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("data-ui-bridge-image-slot")).toBe(slot);
  });

  it("an alt: required slot: the alt text studio wrote into the binding", () => {
    const slot = "marketing.home.hero";
    const m = load("diffusion-alt-required", slot);
    expect(m?.slots[slot]?.binding?.alt_text).toBe(
      "A person at a desk watches a run finish."
    );
    const img = renderSlot(slot).querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe(
      "A person at a desk watches a run finish."
    );
  });

  it("an alt: required slot prefers the binding's alt_text, the ImageSlotProvenance record", () => {
    const slot = "marketing.home.hero";
    const m = load("diffusion-alt-required", slot);
    const entry = m?.slots[slot];
    if (!entry) {
      throw new Error("fixture has no entry");
    }
    entry.alt_text = "A stale copy.";
    const img = renderSlot(slot).querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe(
      "A person at a desk watches a run finish."
    );
  });

  it("an alt: required slot reads the entry's alt_text when the binding lacks one", () => {
    const slot = "marketing.home.hero";
    const m = load("diffusion-alt-required", slot);
    delete m?.slots[slot]?.binding?.alt_text;
    const img = renderSlot(slot).querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe(
      "A person at a desk watches a run finish."
    );
  });

  it("an alt: required slot with no alt text anywhere is withheld", () => {
    const slot = "marketing.home.hero";
    const m = load("diffusion-alt-required", slot);
    delete m?.slots[slot]?.binding?.alt_text;
    delete m?.slots[slot]?.alt_text;
    const el = renderSlot(slot);
    expect(el.getAttribute("data-ui-bridge-placeholder-reason")).toBe(
      "alt_text_missing"
    );
  });

  it("a traced slot: the SVG as a source over its PNG", () => {
    const slot = "sessions.empty-state";
    const m = load("traced", slot);
    const el = renderSlot(slot);
    expect(sources(el)).toEqual([
      ["image/svg+xml", `/image-slots/${slot}.svg?sha=${sha(m, slot, "svg")}`],
    ]);
    expect(el.querySelector("img")?.getAttribute("src")).toBe(
      `/image-slots/${slot}.png?sha=${sha(m, slot, "png")}`
    );
  });

  it("an og:image slot: one PNG, no sources", () => {
    const slot = "marketing.og";
    const m = load("og-card", slot);
    const el = renderSlot(slot);
    expect(sources(el)).toEqual([]);
    expect(el.querySelector("img")?.getAttribute("src")).toBe(
      `/image-slots/${slot}.png?sha=${sha(m, slot, "png")}`
    );
  });

  it("a JPEG studio keys `jpeg` (and writes as .jpg) is served", () => {
    const slot = "marketing.og";
    const m = load("og-card", slot);
    const entry = m?.slots[slot];
    if (!entry) {
      throw new Error("fixture has no entry");
    }
    entry.files = { jpeg: `${slot}.jpg` };
    entry.sha256 = { jpeg: "a".repeat(64) };
    expect(renderSlot(slot).querySelector("img")?.getAttribute("src")).toBe(
      `/image-slots/${slot}.jpg?sha=${"a".repeat(64)}`
    );
  });

  it("an agent-authored SVG renders inline, marker and currentColor intact", () => {
    const slot = "onboarding.connect";
    load("authored-svg", slot);
    const el = renderSlot(slot);
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("data-ui-bridge-image-slot")).toBe(slot);
    expect(el.hasAttribute("data-ui-bridge-placeholder")).toBe(false);
    expect(el.getAttribute("aria-hidden")).toBe("true"); // decorative
    const svg = el.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 400 300");
    expect(el.innerHTML).toContain('stroke="currentColor"');
    expect(el.innerHTML).toContain("trainedAlgorithmicMedia");
  });

  it("an authored SVG of an alt: text slot is an img with its label", () => {
    const slot = "onboarding.connect";
    load("authored-svg", slot);
    state.spec = {
      ...(state.spec as ImageSlotSpec),
      alt: { kind: "text", text: "Connect a runner" },
    };
    const el = renderSlot(slot);
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("Connect a runner");
    expect(el.hasAttribute("aria-hidden")).toBe(false);
  });

  it.each<[string, (text: string) => string, string]>([
    [
      "stale (drawn for another spec version)",
      (t) =>
        t.replace(
          /data-slot-spec-sha256="[0-9a-f]+"/,
          `data-slot-spec-sha256="${"0".repeat(64)}"`
        ),
      "authored_stale",
    ],
    [
      "unmarked",
      (t) => t.replace(/<metadata>[\s\S]*<\/metadata>/, ""),
      "authored_unmarked",
    ],
  ])(
    "an authored SVG that is %s renders the placeholder",
    (_, mutate, reason) => {
      const slot = "onboarding.connect";
      load("authored-svg", slot);
      const text = fs.readFileSync(
        path.join(FIXTURES, "authored-svg", `${slot}.svg`),
        "utf8"
      );
      state.svg = compileAuthoredSvg(
        `${slot}.svg`,
        mutate(text),
        state.spec as unknown as Record<string, unknown>,
        (t) => new DOMParser().parseFromString(t, "image/svg+xml")
      );
      const el = renderSlot(slot);
      expect(el.getAttribute("data-ui-bridge-placeholder")).toBe("true");
      expect(el.getAttribute("data-ui-bridge-placeholder-reason")).toBe(reason);
      expect(el.innerHTML).not.toContain("--qontinui-brand-primary");
    }
  );
});
