/**
 * The image-slot inventory: which declared slots still ship a placeholder.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14 step 4. A
 * shipped placeholder is a FINDING the inventory reports, never a build
 * failure: images are reversible, and only promoted deterministic checks gate
 * a merge (decision D4). So a placeholder row is listed, in the job's step
 * summary and as a `::notice`, and fails nothing. What DOES fail is a defect
 * in the inventory's own inputs, because a listing built on it would be wrong:
 * an unreadable manifest, a manifest entry or file nobody declared, a
 * placement the inventory cannot attribute to a slot, or a rendered marker
 * that contradicts the resolution.
 *
 * Each row is read from BOTH sources the phase names:
 * - the slot manifest, through {@link resolveSlotImage} — the same call
 *   `<SlotImage>` makes, so the listing cannot drift from what renders;
 * - the `data-ui-bridge-placeholder` marker on the element `<SlotImage>`
 *   actually renders for the slot (the caller renders it and passes the
 *   markup), so the listing reports the attribute the UI Bridge reads.
 *
 * Phase 15's `no_placeholder_images` assertion joins this listing when it
 * lands; it is defined there, not here.
 *
 * Build tooling: this module imports the TypeScript compiler to find
 * placements, and only `inventory.ci.test.tsx` imports it. App code never
 * should.
 */

import ts from "typescript";
import type { ImageSlotSpec } from "@qontinui/shared-types";
import {
  PLACEHOLDER_REASON_TEXT,
  resolveSlotImage,
  servableFiles,
  type AuthoredSvg,
  type ManifestRead,
  type PlaceholderReason,
  type SlotResolution,
} from "./manifest";
import {
  PUBLISHED_PROFILE,
  SvgRefused,
  checkSvg,
  type XmlParse,
} from "./svg-allowlist";

/** One `<SlotImage>` element in the app's source. */
export interface SlotPlacement {
  /** Path relative to `frontend/`. */
  file: string;
  /** 1-based. */
  line: number;
  /** The slot id, when `slot` is a string literal; `null` when it is not. */
  slot: string | null;
  /** The `slot` attribute's source text, for a non-literal one. */
  expression: string;
}

/** Every `<SlotImage>` element in one TSX source file. Comments and strings
 *  are not elements, so the component's own docs never count. */
export function findPlacements(file: string, source: string): SlotPlacement[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const out: SlotPlacement[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sf) === "SlotImage"
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const attr = node.attributes.properties.find(
        (p): p is ts.JsxAttribute =>
          ts.isJsxAttribute(p) && p.name.getText(sf) === "slot"
      );
      const init = attr?.initializer;
      let slot: string | null = null;
      if (init && ts.isStringLiteral(init)) {
        slot = init.text;
      } else if (
        init &&
        ts.isJsxExpression(init) &&
        init.expression &&
        ts.isStringLiteralLike(init.expression)
      ) {
        slot = init.expression.text;
      }
      out.push({
        file,
        line,
        slot,
        expression: init ? init.getText(sf) : "<no slot attribute>",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** What the rendered element of one slot says about itself. */
export interface RenderedMarker {
  /** `data-ui-bridge-image-slot`, or `null` when absent. */
  slot: string | null;
  /** True when `data-ui-bridge-placeholder="true"` is present. */
  placeholder: boolean;
  /** `data-ui-bridge-placeholder-reason`, or `null`. */
  reason: string | null;
}

/** Read the markers off the ROOT element of `<SlotImage>`'s markup (the
 *  placeholder `div`, or the asset's `img` inside its `picture`). */
export function readRenderedMarker(markup: string): RenderedMarker {
  const tag =
    /<(?:div|img)\b[^>]*\bdata-ui-bridge-image-slot="[^"]*"[^>]*>/.exec(
      markup
    )?.[0];
  if (tag === undefined) {
    return { slot: null, placeholder: false, reason: null };
  }
  const attr = (name: string) =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
  return {
    slot: attr("data-ui-bridge-image-slot"),
    placeholder: attr("data-ui-bridge-placeholder") === "true",
    reason: attr("data-ui-bridge-placeholder-reason"),
  };
}

export interface InventoryRow {
  slot: string;
  role: ImageSlotSpec["role"];
  resolution: SlotResolution;
  rendered: RenderedMarker;
  placements: SlotPlacement[];
}

export interface Inventory {
  rows: InventoryRow[];
  /** Defects in the inventory's inputs. Non-empty fails the run. */
  defects: string[];
}

export interface InventoryInput {
  specs: Readonly<Record<string, ImageSlotSpec>>;
  manifest: ManifestRead;
  placements: readonly SlotPlacement[];
  /** File names present in `public/image-slots/`. */
  publishedFiles: ReadonlySet<string>;
  /** Agent-authored inline SVGs (`image-slots/<slot>.svg`), by slot id. */
  authoredSvgs: Readonly<Record<string, AuthoredSvg>>;
  /** Every `public/image-slots/*.svg`, which is a same-origin document when
   *  opened directly: each must pass the SVG allowlist (published profile)
   *  and carry the IPTC marker. */
  publishedSvgs: ReadonlyArray<{ name: string; text: string }>;
  /** The XML parser the SVG allowlist checks with. */
  parse: XmlParse;
  /** `<SlotImage slot>`'s markup, rendered for real. */
  render: (slot: string) => string;
}

export function buildInventory(input: InventoryInput): Inventory {
  const defects: string[] = [];
  const declared = new Set(Object.keys(input.specs));

  if (!input.manifest.ok) {
    defects.push(
      `public/image-slots/studio-manifest.json is unreadable: ${input.manifest.error}`
    );
  } else {
    for (const [slot, entry] of Object.entries(input.manifest.manifest.slots)) {
      if (!declared.has(slot)) {
        defects.push(
          `the manifest binds slot "${slot}", which no image-slots/${slot}.yaml declares`
        );
      }
      for (const file of Object.values(entry.files)) {
        if (!input.publishedFiles.has(file)) {
          defects.push(
            `the manifest's slot "${slot}" names public/image-slots/${file}, which does not exist`
          );
        }
      }
      if (declared.has(slot) && servableFiles(entry).length === 0) {
        defects.push(
          `the manifest's slot "${slot}" names no file this app can serve`
        );
      }
    }
  }

  for (const { name, text } of input.publishedSvgs) {
    try {
      if (!checkSvg(text, PUBLISHED_PROFILE, input.parse).marked) {
        defects.push(
          `public/image-slots/${name} carries no IPTC AI-generated marker`
        );
      }
    } catch (e) {
      if (!(e instanceof SvgRefused)) {
        throw e;
      }
      defects.push(
        `public/image-slots/${name} is refused by the SVG allowlist: ${e.message}`
      );
    }
  }

  for (const p of input.placements) {
    if (p.slot === null) {
      defects.push(
        `${p.file}:${p.line}: <SlotImage slot=${p.expression}> — the slot must be a string literal, or the inventory cannot say which slot ships there`
      );
    } else if (!declared.has(p.slot)) {
      defects.push(
        `${p.file}:${p.line}: <SlotImage slot="${p.slot}"> names an undeclared slot`
      );
    }
  }

  const rows = [...declared].sort().map((slot): InventoryRow => {
    const spec = input.specs[slot] as ImageSlotSpec;
    const authored = Object.hasOwn(input.authoredSvgs, slot)
      ? input.authoredSvgs[slot]
      : undefined;
    const resolution = resolveSlotImage(slot, spec, input.manifest, authored);
    if (
      resolution.kind === "placeholder" &&
      resolution.reason === "asset_conflict"
    ) {
      defects.push(
        `slot "${slot}" is bound twice: image-slots/${slot}.svg and a manifest entry. A slot has one route; remove one`
      );
    }
    const rendered = readRenderedMarker(input.render(slot));
    if (rendered.slot !== slot) {
      defects.push(
        `<SlotImage slot="${slot}"> rendered no element marked data-ui-bridge-image-slot="${slot}"`
      );
    }
    const isPlaceholder = resolution.kind === "placeholder";
    if (
      rendered.placeholder !== isPlaceholder ||
      (isPlaceholder && rendered.reason !== resolution.reason)
    ) {
      defects.push(
        `slot "${slot}": the rendered marker (placeholder=${rendered.placeholder}, reason=${rendered.reason}) contradicts the manifest's resolution (${isPlaceholder ? `placeholder, ${resolution.reason}` : "asset"})`
      );
    }
    return {
      slot,
      role: spec.role,
      resolution,
      rendered,
      placements: input.placements.filter((p) => p.slot === slot),
    };
  });

  return { rows, defects };
}

/** The rows still shipping a placeholder somewhere in the app. */
export function shippedPlaceholders(inventory: Inventory): InventoryRow[] {
  return inventory.rows.filter(
    (row) => row.rendered.placeholder && row.placements.length > 0
  );
}

const RENDERS: Readonly<Record<SlotResolution["kind"], string>> = {
  asset: "asset",
  inline_svg: "authored inline SVG",
  placeholder: "placeholder",
};

function where(row: InventoryRow): string {
  return row.placements.length === 0
    ? "not placed"
    : row.placements.map((p) => `\`${p.file}:${p.line}\``).join(", ");
}

/** The listing, as a Markdown section for a CI step summary. */
export function renderMarkdown(inventory: Inventory): string {
  const shipped = shippedPlaceholders(inventory);
  const lines = [
    "## Image slots still shipping a placeholder",
    "",
    `${shipped.length} of ${inventory.rows.length} declared slot(s) render a placeholder where they are placed. ` +
      "A placeholder is a finding, not a failure (plan 2026-10-13-image-generation-and-visual-judgment, Phase 14).",
    "",
    "| Slot | Role | Renders | Reason | Placed at |",
    "| --- | --- | --- | --- | --- |",
    ...inventory.rows.map(
      (row) =>
        `| \`${row.slot}\` | ${row.role} | ${RENDERS[row.resolution.kind]} | ${row.rendered.reason ?? ""} | ${where(row)} |`
    ),
  ];
  if (inventory.defects.length > 0) {
    lines.push(
      "",
      "### Defects (these fail the run)",
      "",
      ...inventory.defects.map((d) => `- ${d}`)
    );
  }
  return `${lines.join("\n")}\n`;
}

function reasonText(reason: string | null): string {
  return reason !== null && Object.hasOwn(PLACEHOLDER_REASON_TEXT, reason)
    ? PLACEHOLDER_REASON_TEXT[reason as PlaceholderReason]
    : "the placeholder marker names no reason this inventory knows";
}

/** One GitHub Actions `::notice` per placement of a placeholder slot. */
export function renderAnnotations(inventory: Inventory): string[] {
  return shippedPlaceholders(inventory).flatMap((row) =>
    row.placements.map(
      (p) =>
        `::notice file=frontend/${p.file},line=${p.line},title=Image slot ships a placeholder::slot "${row.slot}" (${row.role}) renders its placeholder (${row.rendered.reason}): ${reasonText(row.rendered.reason)}`
    )
  );
}
