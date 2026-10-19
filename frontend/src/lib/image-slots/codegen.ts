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

import { createHash } from "crypto";
import { parseDocument } from "yaml";

import {
  authoredProfile,
  checkSvg,
  serializeSvg,
  SvgRefused,
  type XmlParse,
} from "./svg-allowlist";

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

/** An authored SVG's state, decided at generation:
 *  - `current`: marked, and made for the spec as it stands;
 *  - `stale`: its `data-slot-spec-sha256` is not the spec's content hash
 *    (the spec changed since it was drawn, as studio's `authored_stale`);
 *  - `unmarked`: no IPTC AI-generated marker in its `<metadata>`.
 *  Only a `current` one renders; the others render the placeholder. */
export type AuthoredSvgStatus = "current" | "stale" | "unmarked";

/** The spec's content address, as qontinui-schemas'
 *  `ImageSlotSpec::content_sha256` computes it: sha256 of its RFC 8785
 *  canonical JSON, `provenance` left out and absent optional fields omitted.
 *  For the values a spec holds (strings, finite numbers, booleans, lists and
 *  maps) JavaScript's own `JSON.stringify` of a number and a string IS the
 *  RFC 8785 form, and the default sort orders keys by UTF-16 code units. */
export function specContentSha256(spec: Record<string, unknown>): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map(canonical).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${value} has no RFC 8785 form`);
    }
    return JSON.stringify(value);
  };
  const { provenance: _provenance, ...authored } = spec;
  return createHash("sha256").update(canonical(authored), "utf8").digest("hex");
}

/** Check, re-serialise and classify one authored SVG. */
export function compileAuthoredSvg(
  file: string,
  text: string,
  spec: Record<string, unknown>,
  parse: XmlParse
): { status: AuthoredSvgStatus; markup: string } {
  const textInImage = (spec.text_in_image as { kind?: unknown } | undefined)
    ?.kind;
  let checked;
  try {
    checked = checkSvg(
      text,
      authoredProfile(textInImage !== "forbidden"),
      parse
    );
  } catch (e) {
    if (e instanceof SvgRefused) {
      throw new SpecSourceError(
        file,
        `is rendered inline and is refused: ${e.message}`
      );
    }
    throw e;
  }
  const status: AuthoredSvgStatus = !checked.marked
    ? "unmarked"
    : checked.specSha256 !== specContentSha256(spec)
      ? "stale"
      : "current";
  return { status, markup: serializeSvg(checked) };
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
export function renderSpecRegistry(
  sources: readonly SpecSource[],
  parse: XmlParse
): string {
  const entries = sources
    .filter((source) => !SVG_FILE.test(source.name))
    .map(parseSpec)
    .sort(bySlot);
  const specs = new Map(entries);
  const svgs = sources
    .filter((source) => SVG_FILE.test(source.name))
    .map((source): [string, { status: AuthoredSvgStatus; markup: string }] => {
      const slot = SVG_FILE.exec(source.name)?.[1] as string;
      const spec = specs.get(slot);
      if (spec === undefined) {
        throw new SpecSourceError(
          source.name,
          `no ${slot}.yaml declares this slot`
        );
      }
      return [slot, compileAuthoredSvg(source.name, source.text, spec, parse)];
    })
    .sort(bySlot);
  const svgBody = svgs
    .map(([slot, svg]) => `  ${JSON.stringify(slot)}: ${JSON.stringify(svg)},`)
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
import type { AuthoredSvg } from "./manifest";

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
 *  route), keyed by slot id: checked against the SVG allowlist and
 *  re-serialised from the parsed tree at generation, never passed through. */
export const IMAGE_SLOT_AUTHORED_SVG: Readonly<Record<string, AuthoredSvg>> = {${svgBody === "" ? "" : `\n${svgBody}\n`}};

/** A slot's authored inline SVG, when it has one. */
export function imageSlotAuthoredSvg(slot: string): AuthoredSvg | undefined {
  return Object.hasOwn(IMAGE_SLOT_AUTHORED_SVG, slot)
    ? IMAGE_SLOT_AUTHORED_SVG[slot]
    : undefined;
}
`;
}
