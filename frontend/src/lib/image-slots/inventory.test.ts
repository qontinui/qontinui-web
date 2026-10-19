import type { ImageSlotSpec } from "@qontinui/shared-types";
import { describe, expect, it } from "vitest";

import {
  buildInventory,
  findPlacements,
  readRenderedMarker,
  renderAnnotations,
  renderMarkdown,
  shippedPlaceholders,
  type InventoryInput,
} from "./inventory";
import type { ManifestRead } from "./manifest";
import { imageSlotSpec } from "./specs.generated";

const SPEC: ImageSlotSpec = imageSlotSpec("runs.active.idle");
const A = "a".repeat(64);

const PLACEHOLDER = (slot: string, reason = "no_asset") =>
  `<div data-ui-bridge-id="image-slot.${slot}" data-ui-bridge-image-slot="${slot}" data-ui-bridge-placeholder="true" data-ui-bridge-placeholder-reason="${reason}" aria-hidden="true" style="aspect-ratio:1/1"></div>`;
const ASSET = (slot: string) =>
  `<picture style="aspect-ratio:1/1"><img data-ui-bridge-id="image-slot.${slot}" data-ui-bridge-image-slot="${slot}" src="/image-slots/${slot}.png?sha=${A}" alt=""/></picture>`;

const EMPTY: ManifestRead = {
  ok: true,
  manifest: { generated_by: "qontinui-studio", slots: {} },
};
const BOUND: ManifestRead = {
  ok: true,
  manifest: {
    generated_by: "qontinui-studio",
    slots: { "s.one": { files: { png: "s.one.png" }, sha256: { png: A } } },
  },
};

function input(overrides: Partial<InventoryInput> = {}): InventoryInput {
  return {
    specs: {
      "s.one": { ...SPEC, slot: "s.one" },
      "s.two": { ...SPEC, slot: "s.two" },
    },
    manifest: EMPTY,
    placements: [
      { file: "src/a.tsx", line: 3, slot: "s.one", expression: '"s.one"' },
    ],
    publishedFiles: new Set(["studio-manifest.json"]),
    authoredSvgs: {},
    render: (slot) => PLACEHOLDER(slot),
    ...overrides,
  };
}

describe("findPlacements", () => {
  it("finds literal slots in self-closing and paired elements, with their lines", () => {
    const source = [
      'import { SlotImage } from "@/components/image-slot/SlotImage";',
      'export const A = () => <SlotImage slot="s.one" />;',
      "export const B = () => (",
      "  <SlotImage className=\"x\" slot={'s.two'}>",
      "  </SlotImage>",
      ");",
    ].join("\n");
    expect(findPlacements("src/a.tsx", source)).toEqual([
      { file: "src/a.tsx", line: 2, slot: "s.one", expression: '"s.one"' },
      { file: "src/a.tsx", line: 4, slot: "s.two", expression: "{'s.two'}" },
    ]);
  });

  it("does not count an element named in a comment or a string", () => {
    const source = [
      '/** Renders `<SlotImage slot="s.one">` for each slot. */',
      'const doc = "<SlotImage slot=\\"s.two\\" />";',
      '// <SlotImage slot="s.three" />',
    ].join("\n");
    expect(findPlacements("src/a.tsx", source)).toEqual([]);
  });

  it("reports a slot it cannot read as null, with its expression", () => {
    const source =
      "export const A = ({ s }) => <><SlotImage slot={s} /><SlotImage /></>;";
    expect(findPlacements("src/a.tsx", source)).toEqual([
      { file: "src/a.tsx", line: 1, slot: null, expression: "{s}" },
      {
        file: "src/a.tsx",
        line: 1,
        slot: null,
        expression: "<no slot attribute>",
      },
    ]);
  });
});

describe("readRenderedMarker", () => {
  it("reads the placeholder's markers", () => {
    expect(
      readRenderedMarker(PLACEHOLDER("s.one", "alt_text_missing"))
    ).toEqual({
      slot: "s.one",
      placeholder: true,
      reason: "alt_text_missing",
    });
  });

  it("reads an asset as no placeholder", () => {
    expect(readRenderedMarker(ASSET("s.one"))).toEqual({
      slot: "s.one",
      placeholder: false,
      reason: null,
    });
  });

  it("reads markup without a slot element as unmarked", () => {
    expect(readRenderedMarker("<div></div>")).toEqual({
      slot: null,
      placeholder: false,
      reason: null,
    });
  });
});

describe("buildInventory", () => {
  it("lists a placed placeholder as a finding, not a defect", () => {
    const inventory = buildInventory(input());
    expect(inventory.defects).toEqual([]);
    expect(shippedPlaceholders(inventory).map((row) => row.slot)).toEqual([
      "s.one",
    ]);
    // s.two is declared but placed nowhere: listed, not shipped.
    expect(
      inventory.rows.map((row) => [row.slot, row.placements.length])
    ).toEqual([
      ["s.one", 1],
      ["s.two", 0],
    ]);
  });

  it("does not list a bound slot as a placeholder", () => {
    const inventory = buildInventory(
      input({
        manifest: BOUND,
        publishedFiles: new Set(["studio-manifest.json", "s.one.png"]),
        render: (slot) => (slot === "s.one" ? ASSET(slot) : PLACEHOLDER(slot)),
      })
    );
    expect(inventory.defects).toEqual([]);
    expect(shippedPlaceholders(inventory)).toEqual([]);
  });

  it.each<[string, Partial<InventoryInput>, string]>([
    [
      "an unreadable manifest",
      {
        manifest: { ok: false, error: "boom" },
        render: (s) => PLACEHOLDER(s, "manifest_unreadable"),
      },
      "public/image-slots/studio-manifest.json is unreadable: boom",
    ],
    [
      "a manifest entry nobody declared",
      {
        manifest: {
          ok: true,
          manifest: {
            generated_by: "qontinui-studio",
            slots: {
              "s.ghost": { files: { png: "g.png" }, sha256: { png: A } },
            },
          },
        },
        publishedFiles: new Set(["g.png"]),
      },
      'the manifest binds slot "s.ghost", which no image-slots/s.ghost.yaml declares',
    ],
    [
      "a manifest file missing from the publish dir",
      {
        manifest: BOUND,
        render: (s) => (s === "s.one" ? ASSET(s) : PLACEHOLDER(s)),
      },
      'the manifest\'s slot "s.one" names public/image-slots/s.one.png, which does not exist',
    ],
    [
      "a placement whose slot is not a literal",
      {
        placements: [
          { file: "src/a.tsx", line: 9, slot: null, expression: "{s}" },
        ],
      },
      "src/a.tsx:9: <SlotImage slot={s}> — the slot must be a string literal, or the inventory cannot say which slot ships there",
    ],
    [
      "a placement of an undeclared slot",
      {
        placements: [
          {
            file: "src/a.tsx",
            line: 9,
            slot: "s.nine",
            expression: '"s.nine"',
          },
        ],
      },
      'src/a.tsx:9: <SlotImage slot="s.nine"> names an undeclared slot',
    ],
    [
      "a rendered marker contradicting the resolution",
      { render: (s) => ASSET(s) },
      'slot "s.one": the rendered marker (placeholder=false, reason=null) contradicts the manifest\'s resolution (placeholder, no_asset)',
    ],
    [
      "a render with no slot element",
      { render: () => "<div></div>" },
      '<SlotImage slot="s.one"> rendered no element marked data-ui-bridge-image-slot="s.one"',
    ],
  ])("fails on %s", (_, overrides, defect) => {
    expect(buildInventory(input(overrides)).defects).toContain(defect);
  });
});

describe("the report", () => {
  it("renders a Markdown table and one notice per shipped placeholder", () => {
    const inventory = buildInventory(input());
    const markdown = renderMarkdown(inventory);
    expect(markdown).toContain(
      "1 of 2 declared slot(s) render a placeholder where they are placed."
    );
    expect(markdown).toContain(
      "| `s.one` | empty_state | placeholder | no_asset | `src/a.tsx:3` |"
    );
    expect(markdown).toContain(
      "| `s.two` | empty_state | placeholder | no_asset | not placed |"
    );
    expect(markdown).not.toContain("Defects");
    expect(renderAnnotations(inventory)).toEqual([
      '::notice file=frontend/src/a.tsx,line=3,title=Image slot ships a placeholder::slot "s.one" (empty_state) renders its placeholder (no_asset): no asset is bound to it in public/image-slots/studio-manifest.json',
    ]);
  });

  it.each([
    [
      "manifest_unreadable",
      "public/image-slots/studio-manifest.json could not be read",
    ],
    ["asset_unusable", "its manifest entry names no file this app can serve"],
    [
      "alt_text_missing",
      "its alt is `required` and its binding records no alt_text, so the asset is withheld",
    ],
    [
      "not_a_reason",
      "the placeholder marker names no reason this inventory knows",
    ],
  ])("says what a %s placeholder means", (reason, text) => {
    const inventory = buildInventory(
      input({ render: (slot) => PLACEHOLDER(slot, reason) })
    );
    expect(renderAnnotations(inventory)).toEqual([
      `::notice file=frontend/src/a.tsx,line=3,title=Image slot ships a placeholder::slot "s.one" (empty_state) renders its placeholder (${reason}): ${text}`,
    ]);
  });

  it("lists defects under their own heading", () => {
    const inventory = buildInventory(input({ render: () => "<div></div>" }));
    expect(renderMarkdown(inventory)).toContain(
      "### Defects (these fail the run)"
    );
  });
});

describe("authored inline SVGs in the inventory", () => {
  const SVG = '<svg viewBox="0 0 1 1"></svg>';
  const INLINE = (slot: string) =>
    `<div data-ui-bridge-id="image-slot.${slot}" data-ui-bridge-image-slot="${slot}" aria-hidden="true" style="aspect-ratio:1/1">${SVG}</div>`;

  it("lists an authored slot as rendering its inline SVG, not a placeholder", () => {
    const inventory = buildInventory(
      input({
        authoredSvgs: { "s.one": SVG },
        render: (slot) => (slot === "s.one" ? INLINE(slot) : PLACEHOLDER(slot)),
      })
    );
    expect(inventory.defects).toEqual([]);
    expect(shippedPlaceholders(inventory)).toEqual([]);
    expect(renderMarkdown(inventory)).toContain(
      "| `s.one` | empty_state | authored inline SVG |  | `src/a.tsx:3` |"
    );
  });

  it("fails on a slot bound both by an authored SVG and a manifest entry", () => {
    const inventory = buildInventory(
      input({
        manifest: BOUND,
        publishedFiles: new Set(["studio-manifest.json", "s.one.png"]),
        authoredSvgs: { "s.one": SVG },
        render: (slot) =>
          PLACEHOLDER(slot, slot === "s.one" ? "asset_conflict" : "no_asset"),
      })
    );
    expect(inventory.defects).toEqual([
      'slot "s.one" is bound twice: image-slots/s.one.svg and a manifest entry. A slot has one route; remove one',
    ]);
  });
});
