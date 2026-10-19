/**
 * The slot manifest, and what a slot renders: its chosen asset, or its
 * placeholder.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14 step 3. The
 * manifest is qontinui-studio's own `studio-manifest.json`, which its publish
 * path writes into a site's `publish_dir` beside the files it places (Phase 19
 * names it as the one manifest format, extended there with the slot-spec
 * hash). For this app that directory is `public/image-slots/`, served at
 * `/image-slots/`. Its shape, per studio's `_manifest_entry` (`publish.py`)
 * plus the fields `studio compile` adds (`compiler/run.py`), keyed by slot id:
 *
 *   { "generated_by": "qontinui-studio",
 *     "slots": { "<slot>": {
 *        "files":  { "<format>": "<file name>" },   format: avif | webp | png
 *        "sha256": { "<format>": "<hex digest>" },          | jpeg | svg
 *        "binding": { …ImageSlotProvenance, "alt_text"?: "…" },
 *        "alt_text"?: "…",   (the same text, when the slot's alt is required)
 *        "slot_id", "slot_spec_sha256", "route", "ai_generated", … } } }
 *
 * Studio writes AVIF + WebP + PNG for a diffusion slot, PNG alone for an
 * og:image, and SVG + PNG for a traced one. `sha256` is what a site appends to
 * each file URL as `?sha=`: a cache-buster, and the proof studio's D7 gate
 * checks that the page shows THIS batch's bytes. The test fixtures under
 * `test-fixtures/image-slots/studio/` are manifests studio itself wrote.
 *
 * The third shape a slot's art takes is an AGENT-AUTHORED INLINE SVG
 * (studio's `svg` route): studio writes no file and no manifest entry for it;
 * the session writes `image-slots/<slot>.svg` beside the spec, and it renders
 * inline, because only inline SVG inherits `currentColor` and the page's
 * `--qontinui-*` custom properties.
 *
 * Resolution is pure and total: every slot resolves to exactly one of an
 * asset, an inline SVG, or a placeholder WITH THE REASON, and the inventory
 * (`npm run image-slots:inventory`) reports exactly what `<SlotImage>`
 * renders because both call {@link resolveSlotImage}.
 */

import type { ImageSlotSpec } from "@qontinui/shared-types";
import studioManifestJson from "../../../public/image-slots/studio-manifest.json";

/** The URL path `public/image-slots/` is served at. */
export const SLOT_PUBLIC_PATH = "/image-slots";

/** One slot's entry, as studio writes it. Only the fields rendering reads are
 *  typed; studio's provenance fields ride along untouched. */
export interface StudioSlotEntry {
  files: Record<string, string>;
  sha256: Record<string, string>;
  /** The slot's `ImageSlotProvenance`, as `studio compile` records it. */
  binding?: { alt_text?: unknown; [field: string]: unknown };
  /** The binding's alt text again, written for an `alt: required` slot. */
  alt_text?: unknown;
  ai_generated?: boolean;
  [field: string]: unknown;
}

export interface StudioManifest {
  generated_by: string;
  slots: Record<string, StudioSlotEntry>;
}

/** A manifest as read: parsed, or unreadable with the reason. */
export type ManifestRead =
  | { ok: true; manifest: StudioManifest }
  | { ok: false; error: string };

/** Studio's format keys (`sites.py` `ExportFormat`; a JPEG is keyed `jpeg`
 *  and written as `.jpg`), with their MIME types, most widely decodable
 *  first: that order picks the `<img src>` fallback. */
const FORMATS: ReadonlyArray<readonly [format: string, mime: string]> = [
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["svg", "image/svg+xml"],
];

/** `<source>` order: a vector first, then the most efficient encoding. */
const SOURCE_ORDER = ["svg", "avif", "webp"];

const SHA256 = /^[0-9a-f]{64}$/;

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** Read a manifest's JSON, refusing any shape rendering cannot trust. */
export function readStudioManifest(raw: unknown): ManifestRead {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "the manifest is not a JSON object" };
  }
  const { generated_by, slots } = raw as Record<string, unknown>;
  if (typeof generated_by !== "string") {
    return { ok: false, error: "`generated_by` is not a string" };
  }
  if (slots === null || typeof slots !== "object" || Array.isArray(slots)) {
    return { ok: false, error: "`slots` is not an object" };
  }
  for (const [slot, entry] of Object.entries(slots)) {
    const fields = entry as Record<string, unknown> | null;
    if (
      fields === null ||
      typeof fields !== "object" ||
      !isRecordOfStrings(fields.files) ||
      !isRecordOfStrings(fields.sha256)
    ) {
      return {
        ok: false,
        error: `slots.${slot} lacks string maps \`files\` and \`sha256\``,
      };
    }
  }
  return { ok: true, manifest: raw as StudioManifest };
}

/** The app's manifest, read once at module load. */
export const SLOT_MANIFEST: ManifestRead =
  readStudioManifest(studioManifestJson);

/** Why a slot renders its placeholder. */
export type PlaceholderReason =
  /** No asset has been chosen for the slot: the manifest has no entry. */
  | "no_asset"
  /** The manifest itself could not be read. */
  | "manifest_unreadable"
  /** The slot's entry names no file this app can serve (an unknown format,
   *  an unsafe file name, or a file without its digest). */
  | "asset_unusable"
  /** The slot's alt is `required`, and its binding records no `alt_text`:
   *  an image without its text alternative is not shipped. */
  | "alt_text_missing"
  /** Both an authored `image-slots/<slot>.svg` and a manifest entry bind the
   *  slot. A slot has one route, so neither is shown over the other. */
  | "asset_conflict";

/** Why a placeholder renders, in words, for listings and notices. */
export const PLACEHOLDER_REASON_TEXT: Readonly<
  Record<PlaceholderReason, string>
> = {
  no_asset:
    "no asset is bound to it in public/image-slots/studio-manifest.json",
  manifest_unreadable:
    "public/image-slots/studio-manifest.json could not be read",
  asset_unusable: "its manifest entry names no file this app can serve",
  alt_text_missing:
    "its alt is `required` and its binding records no alt_text, so the asset is withheld",
  asset_conflict:
    "both an authored image-slots/<slot>.svg and a manifest entry bind it; a slot has one route",
};

export interface SlotSource {
  type: string;
  srcSet: string;
}

export type SlotResolution =
  | {
      kind: "asset";
      /** `<source>` elements, most efficient first. */
      sources: SlotSource[];
      /** The `<img src>`: the most widely decodable format published. */
      src: string;
      /** `""` for a decorative slot. */
      alt: string;
    }
  | {
      kind: "inline_svg";
      /** The authored SVG document, rendered inline. */
      markup: string;
      /** `""` for a decorative slot. */
      alt: string;
    }
  | { kind: "placeholder"; reason: PlaceholderReason };

/** A file name studio may have written into the publish dir, and no more. */
function isServableName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== ".."
  );
}

/** The URL of one published file, with studio's `?sha=` cache-buster. */
export function slotFileUrl(file: string, sha256: string): string {
  return `${SLOT_PUBLIC_PATH}/${encodeURIComponent(file)}?sha=${sha256}`;
}

/** One published file this app can serve. */
export interface ServableFile {
  format: string;
  mime: string;
  url: string;
}

/** The servable files of one manifest entry, most widely decodable first. */
export function servableFiles(entry: StudioSlotEntry): ServableFile[] {
  const out: ServableFile[] = [];
  for (const [format, mime] of FORMATS) {
    const file = entry.files[format];
    const digest = entry.sha256[format];
    if (
      file !== undefined &&
      isServableName(file) &&
      digest !== undefined &&
      SHA256.test(digest)
    ) {
      out.push({ format, mime, url: slotFileUrl(file, digest) });
    }
  }
  return out;
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The text alternative, or `null` when an `alt: required` slot has none.
 *  For a required slot it is the binding studio wrote (`binding.alt_text`,
 *  repeated as the entry's `alt_text`), else a binding authored inline in
 *  the spec (`provenance.alt_text`). */
function altText(spec: ImageSlotSpec, entry?: StudioSlotEntry): string | null {
  switch (spec.alt.kind) {
    case "decorative":
      return "";
    case "text":
      return spec.alt.text;
    case "required":
      return (
        nonBlank(entry?.binding?.alt_text) ??
        nonBlank(entry?.alt_text) ??
        nonBlank(spec.provenance?.alt_text)
      );
  }
}

/** What `<SlotImage slot>` renders: the chosen asset, the authored inline
 *  SVG, or the placeholder. */
export function resolveSlotImage(
  slot: string,
  spec: ImageSlotSpec,
  manifest: ManifestRead,
  authoredSvg?: string
): SlotResolution {
  // Own keys only: a slot named after an Object.prototype member
  // (`constructor`, `toString`) must not resolve to the inherited value.
  const entry =
    manifest.ok && Object.hasOwn(manifest.manifest.slots, slot)
      ? manifest.manifest.slots[slot]
      : undefined;
  if (authoredSvg !== undefined) {
    if (entry !== undefined) {
      return { kind: "placeholder", reason: "asset_conflict" };
    }
    // The authored SVG is source in this repo, not a manifest file, so it
    // does not depend on the manifest being readable.
    const alt = altText(spec);
    return alt === null
      ? { kind: "placeholder", reason: "alt_text_missing" }
      : { kind: "inline_svg", markup: authoredSvg, alt };
  }
  if (!manifest.ok) {
    return { kind: "placeholder", reason: "manifest_unreadable" };
  }
  if (entry === undefined) {
    return { kind: "placeholder", reason: "no_asset" };
  }
  const [fallback, ...rest] = servableFiles(entry);
  if (fallback === undefined) {
    return { kind: "placeholder", reason: "asset_unusable" };
  }
  const alt = altText(spec, entry);
  if (alt === null) {
    return { kind: "placeholder", reason: "alt_text_missing" };
  }
  const sources = SOURCE_ORDER.flatMap((format) =>
    rest
      .filter((file) => file.format === format)
      .map((file) => ({ type: file.mime, srcSet: file.url }))
  );
  return { kind: "asset", sources, src: fallback.url, alt };
}
