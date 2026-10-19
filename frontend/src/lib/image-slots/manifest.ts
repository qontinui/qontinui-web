/**
 * The slot manifest, and what a slot renders: its chosen asset, or its
 * placeholder.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14 step 3. The
 * manifest is qontinui-studio's own `studio-manifest.json`, which its publish
 * path writes into a site's `publish_dir` beside the files it places (Phase 19
 * names it as the one manifest format, extended there with the slot-spec
 * hash). For this app that directory is `public/image-slots/`, served at
 * `/image-slots/`. Its shape, per studio's `_manifest_entry` (`publish.py`):
 *
 *   { "generated_by": "qontinui-studio",
 *     "slots": { "<slot>": { "files":  { "<format>": "<file name>" },
 *                            "sha256": { "<format>": "<hex digest>" },
 *                            "ai_generated": true, … } } }
 *
 * `sha256` is what a site appends to each file URL as `?sha=`: a cache-buster,
 * and the proof studio's D7 gate checks that the page shows THIS batch's bytes.
 *
 * Resolution is pure and total: every slot resolves to exactly one of an
 * asset or a placeholder WITH THE REASON, and the inventory
 * (`scripts/image-slots.ts inventory`) reports exactly what `<SlotImage>`
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

/** The formats studio publishes (`SLOT_FILE_EXTS`), with their MIME types,
 *  most widely decodable first: that order picks the `<img src>` fallback. */
const FORMATS: ReadonlyArray<readonly [format: string, mime: string]> = [
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
];

/** `<source>` order: the most efficient encoding first. */
const SOURCE_ORDER = ["avif", "webp"];

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
  | "alt_text_missing";

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

function altText(spec: ImageSlotSpec): string | null {
  switch (spec.alt.kind) {
    case "decorative":
      return "";
    case "text":
      return spec.alt.text;
    case "required":
      return spec.provenance?.alt_text ?? null;
  }
}

/** What `<SlotImage slot>` renders: the chosen asset, or the placeholder. */
export function resolveSlotImage(
  slot: string,
  spec: ImageSlotSpec,
  manifest: ManifestRead
): SlotResolution {
  if (!manifest.ok) {
    return { kind: "placeholder", reason: "manifest_unreadable" };
  }
  const entry = manifest.manifest.slots[slot];
  if (entry === undefined) {
    return { kind: "placeholder", reason: "no_asset" };
  }
  const [fallback, ...rest] = servableFiles(entry);
  if (fallback === undefined) {
    return { kind: "placeholder", reason: "asset_unusable" };
  }
  const alt = altText(spec);
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
