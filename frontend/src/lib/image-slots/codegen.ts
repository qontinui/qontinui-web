/**
 * Compile `frontend/image-slots/*.yaml` into `specs.generated.ts`.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14. A slot's spec
 * is authored as YAML, one file per slot, and `<SlotImage>` needs it in the
 * client bundle (to reserve the slot's aspect ratio and to resolve its alt
 * text). The bundler cannot import YAML, so the specs are compiled into one
 * TypeScript module: a committed, generated file, drift-checked by
 * `codegen.test.ts` in `npm test`, as `generated-types.ts` is drift-checked
 * against its OpenAPI snapshot.
 *
 * This compiler checks only what the registry itself depends on: that each
 * file is one YAML 1.2 mapping whose `slot` is its file name, so slot ids are
 * unique by construction. The generated module types the registry with
 * `satisfies Record<string, ImageSlotSpec>`, so `npm run type-check` refuses a
 * spec whose SHAPE departs from the binding. Every value rule (patterns,
 * ranges, the cross-field rules) is the backend gate's job:
 * `backend/tests/test_image_slot_specs.py` validates every file through the
 * generated pydantic model. The TypeScript binding is declarations only and
 * cannot do that.
 *
 * Pure: it takes file names and contents and returns text, so the npm script
 * and the drift test share it without either touching the other's I/O.
 */

import { parseDocument } from "yaml";

/** One file as read from `frontend/image-slots/`: a spec, or a slot's
 *  agent-authored inline SVG. */
export interface SpecSource {
  /** The file's name: `<slot>.yaml`, or `<slot>.svg`. */
  name: string;
  text: string;
}

/** Why a spec file cannot be compiled. */
export class SpecSourceError extends Error {
  constructor(
    readonly file: string,
    message: string
  ) {
    super(`${file}: ${message}`);
    this.name = "SpecSourceError";
  }
}

/** Where the generated registry lives, relative to `frontend/`. */
export const REGISTRY_PATH = "src/lib/image-slots/specs.generated.ts";
/** Where the specs live, relative to `frontend/`. */
export const SPEC_DIR = "image-slots";

const SPEC_FILE = /^(.+)\.yaml$/;
const SVG_FILE = /^(.+)\.svg$/;

/** What an authored SVG must not carry, whatever studio's validator said:
 *  it is rendered INLINE, into the page's own DOM. Studio's `svg` route
 *  (`compiler/selected.py`) admits only drawing elements, so none of these
 *  appears in an SVG studio accepted; this is the web side's own floor. */
const SVG_FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/<!DOCTYPE|<!ENTITY/i, "a DTD or entity declaration"],
  [/<\s*script\b/i, "a <script> element"],
  [/<\s*style\b/i, "a <style> element"],
  [/<\s*foreignObject\b/i, "a <foreignObject> element"],
  [/\son[a-z]+\s*=/i, "an event-handler attribute"],
  [/\b(?:xlink:)?href\s*=/i, "an href (nothing inline may fetch or link)"],
  [/javascript:/i, "a javascript: URL"],
];

/** The SVG document, prologue removed, or a refusal. */
function parseAuthoredSvg(source: SpecSource): [string, string] {
  const slot = SVG_FILE.exec(source.name)?.[1] as string;
  const markup = source.text
    .replace(/^\uFEFF?\s*(<\?xml[^>]*\?>\s*)?/, "")
    .trimEnd();
  if (!/^<svg[\s>]/.test(markup)) {
    throw new SpecSourceError(
      source.name,
      "an authored SVG's root element is <svg>"
    );
  }
  for (const [pattern, what] of SVG_FORBIDDEN) {
    if (pattern.test(markup)) {
      throw new SpecSourceError(
        source.name,
        `is rendered inline and carries ${what}`
      );
    }
  }
  return [slot, markup];
}

function parseSpec(source: SpecSource): [string, Record<string, unknown>] {
  const match = SPEC_FILE.exec(source.name);
  if (!match?.[1]) {
    throw new SpecSourceError(source.name, "a spec file is named <slot>.yaml");
  }
  // YAML 1.2, core schema: `yes` stays a string and `4:3` is not 243, which
  // is how the Rust contract (serde_yaml_ng) reads the same file.
  const doc = parseDocument(source.text, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (doc.errors.length > 0) {
    throw new SpecSourceError(
      source.name,
      `not valid YAML 1.2: ${doc.errors.map((e) => e.message).join("; ")}`
    );
  }
  const value: unknown = doc.toJS();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SpecSourceError(source.name, "a spec is one YAML mapping");
  }
  const spec = value as Record<string, unknown>;
  if (spec.slot !== match[1]) {
    throw new SpecSourceError(
      source.name,
      `declares slot ${JSON.stringify(spec.slot)}; a spec file is named <slot>.yaml`
    );
  }
  return [match[1], spec];
}

const bySlot = <T>([a]: [string, T], [b]: [string, T]) =>
  a < b ? -1 : a > b ? 1 : 0;

/** The text of `specs.generated.ts` for these files. */
export function renderSpecRegistry(sources: readonly SpecSource[]): string {
  const entries = sources
    .filter((source) => !SVG_FILE.test(source.name))
    .map(parseSpec)
    .sort(bySlot);
  const declared = new Set(entries.map(([slot]) => slot));
  const svgs = sources
    .filter((source) => SVG_FILE.test(source.name))
    .map(parseAuthoredSvg)
    .sort(bySlot);
  for (const [slot] of svgs) {
    if (!declared.has(slot)) {
      throw new SpecSourceError(
        `${slot}.svg`,
        `no ${slot}.yaml declares this slot`
      );
    }
  }
  const svgBody = svgs
    .map(
      ([slot, markup]) =>
        `  ${JSON.stringify(slot)}: ${JSON.stringify(markup)},`
    )
    .join("\n");
  const body = entries
    .map(([slot, spec]) => {
      const json = JSON.stringify(spec, null, 2).replace(/\n/g, "\n  ");
      return `  ${JSON.stringify(slot)}: ${json},`;
    })
    .join("\n");
  return `// GENERATED by \`npm run image-slots:generate\` from ${SPEC_DIR}/*.yaml
// and ${SPEC_DIR}/*.svg.
// DO NOT EDIT BY HAND: edit the YAML and regenerate. \`npm test\` fails on any
// drift (src/lib/image-slots/codegen.test.ts). Plan
// 2026-10-13-image-generation-and-visual-judgment, Phase 14.

import type { ImageSlotSpec } from "@qontinui/shared-types";

/** Every declared image slot's spec, keyed by slot id. */
export const IMAGE_SLOT_SPECS = {
${body}
} satisfies Record<string, ImageSlotSpec>;

/** A declared slot id. \`<SlotImage slot>\` takes only these. */
export type ImageSlotId = keyof typeof IMAGE_SLOT_SPECS;

/** Every declared slot id, sorted. */
export const IMAGE_SLOT_IDS = Object.keys(IMAGE_SLOT_SPECS).sort() as ImageSlotId[];

/** The spec of a declared slot. */
export function imageSlotSpec(slot: ImageSlotId): ImageSlotSpec {
  return IMAGE_SLOT_SPECS[slot];
}

/** Agent-authored inline SVGs (\`${SPEC_DIR}/<slot>.svg\`, studio's \`svg\`
 *  route), keyed by slot id. */
export const IMAGE_SLOT_AUTHORED_SVG: Readonly<Record<string, string>> = {${svgBody === "" ? "" : `\n${svgBody}\n`}};

/** A slot's authored inline SVG, when it has one. */
export function imageSlotAuthoredSvg(slot: string): string | undefined {
  return Object.hasOwn(IMAGE_SLOT_AUTHORED_SVG, slot)
    ? IMAGE_SLOT_AUTHORED_SVG[slot]
    : undefined;
}
`;
}
