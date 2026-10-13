/**
 * Style-gate snapshot normalizer (pure, unit-testable).
 *
 * Maps the web UI-Bridge `/control/snapshot` element shape into the fields the
 * Rust `vision-audit` analyzer's `Element` schema consumes
 * (qontinui-schemas/rust-vision-core/src/element_snapshot.rs). Kept as a
 * standalone, dependency-free module (Node built-ins only, no Playwright
 * import) so it can be exercised by a vitest unit test directly — and loaded
 * by `verify-page-verdict.sh` through node's native type-stripping, which is
 * why everything here is erasable TypeScript (no enums, no namespaces).
 *
 * MIRROR — `qontinui-claude-config/scripts/uibridge-to-elementsnapshot.py`
 * projects the runner's `/ui-bridge/control/discover` payload into the same
 * `Element` shape for targets this adapter structurally cannot reach (a Tauri
 * WebView has no URL to drive). That script's header says the duplication is
 * a KNOWN drift risk and that "a change to one belongs in the other"; this
 * comment is the other half of that declaration. The field decisions that
 * must stay in step are `deriveInteractable` / `derive_interactable`,
 * `inertReason` / `inert_reason`, `parseCssColor` / `parse_color`,
 * `parsePx` / `parse_px`, `parseOpacity` / `parse_opacity`,
 * `projectMedia` / `project_media` (with `srcDigest` / `src_digest`), the
 * media-row text rule, the absence of any `z_index` projection, and the bbox
 * origin/extent sign rules in `normalizeBboxes` / `project_element`.
 *
 * SOURCE shape (per element from `/control/snapshot`, see
 * ui-bridge/packages/ui-bridge/src/server/handlers.ts `materializeElements`):
 *   {
 *     id, type, tagName, label, role, ariaLabel, accessibleName, text, title,
 *     identifier, state, actions?: string[],
 *     customActions?: Array<{ id, label?, description?, effect? }>,  // SDK >= 0.27
 *     category?: 'interactive'|'content'|'media',
 *     bbox?: { x, y, width, height },   // floats, CSS px
 *     visible?
 *   }
 * where `state` is the SDK `ElementState`
 * (ui-bridge/packages/ui-bridge/src/core/types.ts), carrying
 *   state.textContent, state.role, state.enabled,
 *   state.computedStyles?: { color, backgroundColor, fontSize, fontWeight,
 *                            lineHeight, ... }
 * (NOTE: computedStyles has NO fontFamily today — `font_family` is therefore
 * omitted unless a future SDK adds it; we read it defensively.)
 *
 * TARGET `Element` fields we populate (every one is optional/defaulted on the
 * Rust side except `id`; absent fields are OMITTED, never guessed):
 *   bbox          { x, y, w, h } u32   (handled by `normalizeBboxes`)
 *   text          string               (PAINTED text / textContent — never
 *                                       a media element's alt)
 *   role          string               (ARIA role)
 *   interactable  bool                 (real interactivity — default false)
 *   fg_color      { r, g, b } u8       (computed color, fully opaque only)
 *   bg_color      { r, g, b } u8       (computed backgroundColor, opaque only)
 *   font_size_px  f32                  (computed fontSize, px)
 *   font_family   string               (computed fontFamily, if present)
 *   line_height_px f32                 (computed lineHeight, px)
 *   visible / occluded_by / scroll_width_px / text_overflow
 *   media         ElementMedia         (media rows; see `projectMedia`)
 * and NOT `z_index`, which no CSS value can supply (see `enrichElement`).
 */

import { createHash } from "node:crypto";

/** Rust `Rgb` shape: lowercase r/g/b, u8. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Interactive HTML tags whose mere presence implies interactivity. */
const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "option",
  "summary",
  "details",
]);

/** ARIA roles that imply interactivity. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "textbox",
  "combobox",
  "slider",
  "spinbutton",
  "searchbox",
]);

/**
 * Parse a CSS color string (`rgb(...)`, `rgba(...)`, `#rgb`, `#rrggbb`,
 * `#rrggbbaa`) into `{ r, g, b }` — for a FULLY OPAQUE color only. Returns
 * null for transparent / `none` / unparseable values AND for any partial
 * alpha; the caller OMITS the field rather than guessing, matching the
 * analyzer's "skipped: missing X" contract.
 *
 * Partial alpha is the subtle case. A translucent color is composited over
 * whatever lies beneath it, and the Rust `Rgb` has no alpha channel to carry
 * that. Flattening it to its opaque RGB fabricates a color nobody sees —
 * half-transparent black over a white page is mid-grey, flattened it is
 * BLACK — and a contrast check over the fabricated black can PASS light text
 * that is illegible on the real grey (or fail legible text). The composite
 * needs the backdrop, which a snapshot does not carry, so the color is
 * UNKNOWN. Mirrors `parse_color` in the Python projector.
 */
export function parseCssColor(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s || s === "transparent" || s === "none" || s === "currentcolor") {
    return null;
  }

  // rgb()/rgba() — tolerate both comma and space (CSS Color 4) separators.
  const rgbMatch = s.match(
    /^rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)(?:\s*[,/]\s*([0-9.%]+))?\s*\)$/
  );
  if (rgbMatch) {
    const r = Math.round(Number(rgbMatch[1]));
    const g = Math.round(Number(rgbMatch[2]));
    const b = Math.round(Number(rgbMatch[3]));
    // Transparent or translucent — omit (see above). An alpha that does not
    // parse is unknown, not opaque.
    if (rgbMatch[4] !== undefined) {
      const rawAlpha = rgbMatch[4];
      const alpha = rawAlpha.endsWith("%")
        ? Number(rawAlpha.slice(0, -1)) / 100
        : Number(rawAlpha);
      if (!Number.isFinite(alpha) || alpha < 1) return null;
    }
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return null;
    }
    return { r, g, b };
  }

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa.
  const hexMatch = s.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    let r: number;
    let g: number;
    let b: number;
    let a = 255;
    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16);
    } else {
      return null;
    }
    if (a !== 255) return null; // transparent or translucent — see above
    if (![r, g, b].every((v) => Number.isFinite(v))) return null;
    return { r, g, b };
  }

  return null;
}

/**
 * Parse a CSS pixel length (`"16px"`, `"16"`, `16`) to a finite number, or null.
 * Non-px units (em/rem/%) are NOT resolvable without context -> null (omit).
 * `"normal"` (the default line-height keyword) -> null.
 */
export function parsePx(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s || s === "normal" || s === "auto") return null;
  // Accept a bare number or a px-suffixed value; reject other units.
  const m = s.match(/^(-?[0-9.]+)(px)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a computed `opacity` value to a number, or null for UNKNOWN.
 * Unparseable yields null, which the caller reads as UNKNOWN — never as 0 and
 * never as 1. Mirrors `parse_opacity` in the Python projector.
 */
export function parseOpacity(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  // `Number("")` and `Number("   ")` are 0 — Python's `float("")` RAISES, and
  // reading an empty opacity as 0 would mark every such element inert. Guard
  // the empty string explicitly before converting.
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Narrow an unknown to a plain record. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Why this element cannot be clicked, or null when nothing says it can't.
 * Mirrors `inert_reason` in the Python projector; the returned string is a
 * short diagnostic label, and only `null` vs non-null is load-bearing.
 *
 * Three signals, all of them REAL fields of the `discover` payload and all of
 * them measured on the runner's Terminal page (112 elements, live capture):
 *
 *   - `state.disabled` / `state.ariaDisabled` — the two DOM disabled signals,
 *     the same pair the SDK's own `readDisabledSignals` reads (2 elements).
 *   - `state.computedStyles.pointerEvents === "none"` — the COMPUTED value, so
 *     an ancestor's `none` is already folded in, `pointer-events` being an
 *     inherited property (12 elements).
 *   - `state.computedStyles.opacity` parsing to 0, or the SDK's own spelling of
 *     exactly that fact, `state.opacityHidden` — `registry.ts` defines the
 *     latter as `parseFloat(opacity) === 0`, so it is the SAME fact, not a
 *     second signal (6 elements, the same 6 under either spelling).
 *
 * `state.enabled === false` is accepted as a fourth SPELLING of the first
 * two-plus-one: `core/a11y.ts` `isInteractionBlocked` derives it as exactly
 * `disabled || ariaDisabled || pointerEventsNone`, so it adds no signal — but
 * it keeps the gate correct on a payload carrying `enabled` without
 * `computedStyles` (12 elements).
 *
 * ⚠️ ABSENCE IS UNKNOWN, NEVER INERT — and never interactable either. Every
 * test below fires only on a PRESENT field reading its inert value. An element
 * with no `state`, no `computedStyles`, an unparseable `opacity` (`"inherit"`)
 * or `pointerEvents: ""` (the SDK's own "could not read") is NOT reported
 * inert, and falls through to the tag/role decision. A producer poorer than
 * `discover` says nothing about pointer-events, and suppressing on that silence
 * would empty the overlap pass and hand back a clean bill of health on a broken
 * page — the exact failure this tooling exists to catch.
 *
 * `visibility: hidden`, `display: none` and `aria-hidden` are the adjacent
 * signals, and this function deliberately does NOT read them: the first two
 * never appear in a non-inert value in a `discover` payload (the SDK does not
 * register such elements) and `aria-hidden` is not projected at all, so keying
 * on them would be keying on fields absent by construction. `state.visible` is
 * carried through to the snapshot verbatim by `enrichElement` and stays the
 * analyzer's business, not this one's.
 */
export function inertReason(el: Record<string, unknown>): string | null {
  const state = asRecord(el.state) ?? {};
  const computed = asRecord(state.computedStyles) ?? {};

  if (state.disabled === true) return "disabled";
  if (state.ariaDisabled === true) return "aria-disabled";
  // `=== false`, NOT `!state.enabled`: an ABSENT `enabled` is UNKNOWN.
  if (state.enabled === false) return "state.enabled=false";

  const pe = computed.pointerEvents;
  if (typeof pe === "string" && pe.trim().toLowerCase() === "none") {
    return "pointer-events:none";
  }

  if (state.opacityHidden === true) return "opacity:0";
  // Parsed-and-equals-zero, NOT `op == null || op === 0`: an absent or
  // unparseable opacity is UNKNOWN.
  const op = parseOpacity(computed.opacity);
  if (op !== null && op === 0) return "opacity:0";

  return null;
}

/**
 * Decide `interactable` from real interactivity signals (NOT mere presence of
 * text). Inert elements first, then the SDK's own categorization where
 * available, then interactive tag/role:
 *   - an `inertReason` (see above)         -> FALSE, before anything else, OR
 *   - category === 'interactive'           (the SDK's own classification), OR
 *   - a non-empty `actions` array          (registered handlers), OR
 *   - a non-empty `customActions` array    (registered custom handlers), OR
 *   - an interactive tagName, OR
 *   - an interactive ARIA role.
 * Plain content/containers (category 'content'/'media', no actions, non-
 * interactive tag/role) stay false.
 *
 * WHY THE INERT GATE COMES FIRST: the `layout` analyzer's overlap pass is
 * pairwise over `interactable` elements, so one inert zone overlay stacked
 * across a band reports a spurious collision per live control underneath it —
 * 9 of them on the runner's Terminal page, against controls nothing can hit.
 * `category === "interactive"` is a statement about what an element IS, not
 * about whether it currently accepts a click, and the SDK marks a
 * `pointer-events: none` button `interactive` all the same. Measured on a live
 * 112-element Terminal capture: `interactable` 96 -> 78, `overlap` findings
 * 23 -> 14, exactly the 9 spurious ones gone.
 */
export function deriveInteractable(el: Record<string, unknown>): boolean {
  if (inertReason(el) !== null) return false;

  const category = typeof el.category === "string" ? el.category : undefined;
  if (category === "interactive") return true;
  if (category === "content" || category === "media") {
    // Explicitly non-interactive per the SDK — trust it unless a real handler
    // contradicts (a content element can still carry actions in rare cases).
    if (Array.isArray(el.actions) && el.actions.length > 0) return true;
    if (Array.isArray(el.customActions) && el.customActions.length > 0) {
      return true;
    }
    return false;
  }

  if (Array.isArray(el.actions) && el.actions.length > 0) return true;
  if (Array.isArray(el.customActions) && el.customActions.length > 0) {
    return true;
  }

  const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  if (tag && INTERACTIVE_TAGS.has(tag)) return true;

  const state = asRecord(el.state);
  const role =
    (typeof el.role === "string" && el.role) ||
    (state && typeof state.role === "string" && state.role) ||
    "";
  if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Media — the vision-core `Element.media` record
// ---------------------------------------------------------------------------
//
// `ElementMedia` (qontinui-schemas `rust-vision-core/src/element_media.rs`).
// The SDK's facts arrive in one of two shapes, and BOTH must project, because
// snapshot producers upgrade over time:
//
//   - ENVELOPED (the SDK's media-observation change, plan
//     2026-10-13-image-generation-and-visual-judgment Phase 5):
//     `mediaMetadata` is an Observation — `{status, value, provenance}` —
//     whose `provenance.coverage.unmeasured` names every fact the SDK could
//     not measure. `measured` supplies the fields; an unmeasured dimension, or
//     an `unknown` / `absent` envelope, leaves them OMITTED. An envelope passed
//     through unwrapped would land an object on a scalar field, fail serde, and
//     reject the WHOLE snapshot.
//   - LEGACY (an SDK from before that change): `mediaMetadata` is the bare
//     fact record. Fields that mean the same thing project; `oversizeRatio`
//     (DPR-blind: a correctly sized image reads 2x oversized on a 2x screen)
//     and `transferSize` (0 on every cache hit, keyed on `img.src`) measure
//     something else and are omitted, as are the facts that version never
//     measured.
//
//     REMOVAL TRIGGER for the legacy branch: once every deployed producer
//     emits the envelope — qontinui-web and the runner both run a Phase 5 SDK
//     — delete it here and in the Python projector together.
//
// Mirrors `project_media` in the Python projector; a change to one belongs in
// the other.

/** Rust `MediaKind`. */
export type MediaKind =
  | "img"
  | "picture"
  | "svg"
  | "video"
  | "canvas"
  | "role_img"
  | "css_background";

/** Rust `MediaSize` — a width × height pair. */
export interface MediaSize {
  w: number;
  h: number;
}

/**
 * Rust `MediaAlt`: the text alternative read as ONE measurement. `text`
 * absent beside `decorative: false` is MEASURED — the element has no text
 * alternative — which is why the two travel together.
 */
export interface MediaAlt {
  decorative: boolean;
  text?: string;
}

/** Rust `ElementMedia`. Every field but `kind` is omitted when unmeasured. */
export interface ElementMedia {
  kind: MediaKind;
  natural_px?: MediaSize;
  rendered_px?: MediaSize;
  effective_resolution?: number;
  object_fit?: string;
  object_position?: string;
  dims_reserved?: boolean;
  loading?: string;
  decoding?: string;
  fetch_priority?: string;
  load_state?: string;
  format?: string;
  transfer_bytes?: number;
  alt?: MediaAlt;
  is_lcp_candidate?: boolean;
  cls_contribution?: number;
  slot_id?: string;
  placeholder?: boolean;
  src_digest?: string;
  in_viewport?: boolean;
}

/** SDK `mediaType` -> `MediaKind`, for every type the tag does not refine. */
const MEDIA_TYPE_KINDS: Readonly<Record<string, MediaKind>> = {
  picture: "picture",
  svg: "svg",
  video: "video",
  canvas: "canvas",
  "background-image": "css_background",
};

/** Tags whose kind is unambiguous even when the facts are unreadable. */
const TAG_KINDS: Readonly<Record<string, MediaKind>> = {
  img: "img",
  picture: "picture",
  svg: "svg",
  video: "video",
  canvas: "canvas",
};

/**
 * Kinds whose text content is never PAINTED: an `<img>` has none, a video's
 * or a canvas's is fallback content (the SDK reads a canvas's as its alt),
 * and an SVG's `textContent` mixes painted `<text>` with the unpainted
 * `<title>`/`<desc>` that ARE its alt — nothing in the payload separates them.
 */
const UNPAINTED_TEXT_KINDS: ReadonlySet<MediaKind> = new Set<MediaKind>([
  "img",
  "picture",
  "svg",
  "video",
  "canvas",
]);

const OBJECT_FITS = new Set(["fill", "contain", "cover", "none", "scale-down"]);
const LOADINGS = new Set(["lazy", "eager"]);
const DECODINGS = new Set(["sync", "async", "auto"]);
const FETCH_PRIORITIES = new Set(["high", "low", "auto"]);
const LOAD_STATES = new Set(["pending", "loaded", "error", "lazy"]);

/**
 * Image-optimizer endpoints transcode on the fly; their URL says nothing about
 * the served format (legacy SDKs inferred one from it anyway).
 */
const TRANSCODING_PATH = /\/_(?:next|vercel)\/image\/?$/;

/**
 * `ElementMedia.src_digest`: lowercase hex SHA-256 of the URL's UTF-8 bytes,
 * QUERY KEPT — every `next/image` source is `/_next/image?url=…`, so stripping
 * the query would make every optimized image one image. The shared test vector
 * in `normalize.test.ts` pins this against vision-core's own `src_digest_of`.
 */
export function srcDigest(src: string): string {
  return createHash("sha256").update(src, "utf8").digest("hex");
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mediaSize(w: unknown, h: unknown, positive: boolean): MediaSize | null {
  const fw = finiteNumber(w);
  const fh = finiteNumber(h);
  if (fw === null || fh === null) return null;
  if (positive ? fw <= 0 || fh <= 0 : fw < 0 || fh < 0) return null;
  return { w: fw, h: fh };
}

/**
 * A closed-vocabulary value, or null. Outside the vocabulary is UNKNOWN:
 * `ElementMedia`'s enums would reject the whole snapshot on it.
 */
function keyword(v: unknown, allowed: ReadonlySet<string>): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return allowed.has(s) ? s : null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * HTML's "ASCII whitespace" at either end: tab, LF, FF, CR, space.
 * Deliberately not `String.prototype.trim`, which also strips U+00A0 and every
 * other Unicode space.
 */
const ASCII_WHITESPACE_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/**
 * `ElementMedia.alt` from the SDK's two halves. The text is stripped of ASCII
 * whitespace (HTML's definition), and an alt that is PRESENT and empty after
 * stripping is decorative — `alt="  "` reads as `alt=""` does.
 */
function mediaAlt(altText: unknown, decorative: boolean): MediaAlt {
  if (typeof altText === "string") {
    const text = altText.replace(ASCII_WHITESPACE_EDGES, "");
    return text ? { decorative, text } : { decorative: true };
  }
  return { decorative };
}

/** A non-negative integral byte count (`u64` on the Rust side), or null. */
function byteCount(v: unknown): number | null {
  const n = finiteNumber(v);
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
}

interface UnwrappedMedia {
  /** Null when nothing can be read: an `unknown`/`absent` envelope, or no record. */
  facts: Record<string, unknown> | null;
  unmeasured: ReadonlySet<string>;
  legacy: boolean;
}

function unwrapMedia(raw: unknown): UnwrappedMedia {
  const none: UnwrappedMedia = { facts: null, unmeasured: new Set(), legacy: false };
  const rec = asRecord(raw);
  if (!rec) return none;
  if ("status" in rec) {
    const value = asRecord(rec.value);
    if (rec.status !== "measured" || !value) return none;
    const coverage = asRecord(asRecord(rec.provenance)?.coverage);
    const unmeasuredList: unknown = coverage?.unmeasured;
    const listed: unknown[] = Array.isArray(unmeasuredList) ? unmeasuredList : [];
    const unmeasured = new Set<string>();
    for (const u of listed) {
      const dim = asRecord(u)?.dimension;
      if (typeof dim === "string") unmeasured.add(dim);
    }
    return { facts: value, unmeasured, legacy: false };
  }
  if ("mediaType" in rec) return { facts: rec, unmeasured: new Set(), legacy: true };
  return none;
}

/**
 * `MediaKind` from the SDK's `mediaType`, refined by the tag. The SDK spells
 * both an `<img>` and any `role="img"` element `image`; the tag tells them
 * apart. With no tag the src does (a `role="img"` element never carries one).
 * With no readable facts the tag alone decides, where it can.
 */
function mediaKind(
  mediaType: unknown,
  tag: string | undefined,
  facts: Record<string, unknown> | null
): MediaKind | null {
  if (mediaType === "image") {
    if (tag !== undefined) return tag === "img" ? "img" : "role_img";
    return facts && nonEmpty(facts.src) ? "img" : "role_img";
  }
  if (typeof mediaType === "string" && mediaType in MEDIA_TYPE_KINDS) {
    return MEDIA_TYPE_KINDS[mediaType] ?? null;
  }
  return tag !== undefined ? (TAG_KINDS[tag] ?? null) : null;
}

/**
 * Summed score of the layout shifts that moved the element, excluding shifts
 * within 500 ms of input (CLS excludes those). `[]` is measured: 0. A
 * malformed entry makes the sum UNKNOWN rather than an undercount.
 */
function clsContribution(sources: unknown): number | null {
  if (!Array.isArray(sources)) return null;
  let total = 0;
  for (const entry of sources) {
    const rec = asRecord(entry);
    const value = finiteNumber(rec?.value);
    if (!rec || value === null || typeof rec.hadRecentInput !== "boolean") {
      return null;
    }
    if (!rec.hadRecentInput) total += value;
  }
  return total;
}

function lowerTag(el: Record<string, unknown>): string | undefined {
  return typeof el.tagName === "string" ? el.tagName.trim().toLowerCase() : undefined;
}

/**
 * The `ElementMedia` record for a media row, or null for any other row (and
 * for a media row whose kind cannot be named). Pure: reads the SDK row, writes
 * nothing.
 */
export function projectMedia(el: Record<string, unknown>): ElementMedia | null {
  const state = asRecord(el.state) ?? {};
  const raw = asRecord(el.mediaMetadata) ?? asRecord(state.mediaMetadata);
  if (el.category !== "media" && !raw) return null;
  const tag = lowerTag(el);
  const { facts, unmeasured, legacy } = unwrapMedia(raw);
  const kind = mediaKind(facts?.mediaType, tag, facts);
  if (!kind) return null;
  const media: ElementMedia = { kind };

  if (typeof state.inViewport === "boolean") media.in_viewport = state.inViewport;
  if (!facts) return media;

  // An unmeasured dimension is UNKNOWN even if a value rode along with it.
  const fact = (name: string): unknown => (unmeasured.has(name) ? undefined : facts[name]);
  const redacted = asRecord(state.redaction)?.content === true;

  // `natural_px` is the image RESOURCE's own pixel size. For a srcset
  // candidate the browser's `naturalWidth` is DENSITY-CORRECTED (a 1280w
  // source shown at DPR 2 reads ~640; a `2x` candidate reads half its size),
  // and a legacy SDK reads it raw without saying which candidate it matched —
  // so a legacy row with a `srcset` or `<picture>` sources carries no natural
  // size worth trusting, and it is omitted. An enveloped row's producer
  // de-corrects it by the matched candidate (or omits it), so it passes.
  const natural = mediaSize(fact("naturalWidth"), fact("naturalHeight"), true);
  const sources = fact("sources");
  const densityCorrected =
    legacy && (nonEmpty(fact("srcset")) !== null || (Array.isArray(sources) && sources.length > 0));
  if (natural && !densityCorrected) media.natural_px = natural;
  const rendered = mediaSize(fact("renderedWidth"), fact("renderedHeight"), false);
  if (rendered) media.rendered_px = rendered;

  const src = nonEmpty(fact("src"));
  if (src !== null && !redacted) media.src_digest = srcDigest(src);

  if (legacy) {
    // Only the facts that mean what `ElementMedia` means; see the header.
    const lazy = fact("lazyLoading");
    if ((kind === "img" || kind === "picture") && typeof lazy === "boolean") {
      media.loading = lazy ? "lazy" : "eager";
    }
    if (kind !== "css_background") {
      // A legacy background is always "loaded" — never measured.
      const loadState = keyword(fact("loadingState"), LOAD_STATES);
      if (loadState) media.load_state = loadState;
    }
    const format = nonEmpty(fact("format"));
    let transcoded = false;
    if (src !== null) {
      try {
        transcoded = TRANSCODING_PATH.test(new URL(src, "http://localhost/").pathname);
      } catch {
        transcoded = false;
      }
    }
    if (format && !transcoded) media.format = format;
    // Legacy `isDecorative` is `img.alt === ''`, which reads a MISSING alt as
    // decorative. Only an image whose alt text is present can be trusted; the
    // other kinds measure it from attributes that mean it.
    const altText = fact("altText");
    const decorative = fact("isDecorative");
    if (
      !redacted &&
      typeof decorative === "boolean" &&
      ((kind !== "img" && kind !== "picture") || typeof altText === "string")
    ) {
      media.alt = mediaAlt(altText, decorative);
    }
    return media;
  }

  const effective = finiteNumber(fact("effectiveResolution"));
  if (effective !== null && effective > 0) media.effective_resolution = effective;
  const objectFit = keyword(fact("objectFit"), OBJECT_FITS);
  if (objectFit) media.object_fit = objectFit;
  const position = nonEmpty(fact("objectPosition"));
  if (position) media.object_position = position;
  const dimsReserved = fact("dimsReserved");
  if (typeof dimsReserved === "boolean") media.dims_reserved = dimsReserved;
  const loading = keyword(fact("loading"), LOADINGS);
  if (loading) media.loading = loading;
  const decoding = keyword(fact("decoding"), DECODINGS);
  if (decoding) media.decoding = decoding;
  const fetchPriority = keyword(fact("fetchPriority"), FETCH_PRIORITIES);
  if (fetchPriority) media.fetch_priority = fetchPriority;
  const loadState = keyword(fact("loadingState"), LOAD_STATES);
  if (loadState) media.load_state = loadState;
  const format = nonEmpty(fact("format"));
  if (format) media.format = format;
  const weight = byteCount(fact("encodedBodySize"));
  if (weight !== null) media.transfer_bytes = weight;

  const decorative = facts.isDecorative;
  if (
    !redacted &&
    !unmeasured.has("altText") &&
    !unmeasured.has("isDecorative") &&
    typeof decorative === "boolean"
  ) {
    // The SDK reads both halves together; an absent altText beside them is
    // its MEASURED "this element has no text alternative".
    media.alt = mediaAlt(facts.altText, decorative);
  }
  const lcp = fact("isLcpCandidate");
  if (typeof lcp === "boolean") media.is_lcp_candidate = lcp;
  const cls = clsContribution(fact("clsSources"));
  if (cls !== null) media.cls_contribution = cls;
  const slot = nonEmpty(fact("slotId"));
  if (slot !== null && !redacted) media.slot_id = slot;
  if (!unmeasured.has("placeholder")) {
    // The SDK sets it only when the marker is there: absent-and-unlisted is
    // its measured "no placeholder marker". A PRESENT non-boolean is no
    // reading of the marker at all, so it is omitted, never coerced.
    if (!("placeholder" in facts)) media.placeholder = false;
    else if (typeof facts.placeholder === "boolean") media.placeholder = facts.placeholder;
  }
  return media;
}

/**
 * Enrich a single element record IN PLACE with the analyzer fields derived from
 * the SDK shape. Only sets a field when a real value is available — absent
 * fields are left unset so the Rust serde defaults apply. Pre-existing
 * analyzer-shaped fields on the element are NOT overwritten (a snapshot source
 * that already populated them wins) — with ONE exception: `text` is removed
 * from a media row whose content is never painted (`img`, `picture`, `svg`,
 * `video`, `canvas`). Whatever a source put there is fallback content or an
 * SVG `<title>`, i.e. a text alternative, which the vision-core `Element`
 * contract forbids in `text`; it lives in `media.alt`.
 *
 * It also DELETES the SDK's raw `mediaMetadata` (top level and in `state`)
 * once `media` is projected from it: the raw observation carries the image
 * URLs that `media` reduces to a digest, and these rows are uploaded as CI
 * artifacts from a public repository.
 *
 * Does NOT touch `bbox` — that is `normalizeBboxes`'s job in the spec (the one
 * pre-existing shape transform). Does NOT touch `id`.
 */
export function enrichElement(el: Record<string, unknown>): void {
  const state = asRecord(el.state);
  const computed = state ? asRecord(state.computedStyles) : null;

  // interactable — always set (Rust field defaults false; we compute the real
  // value). Don't clobber a snapshot source that already set a boolean.
  if (typeof el.interactable !== "boolean") {
    el.interactable = deriveInteractable(el);
  }

  // media — the vision-core `ElementMedia` record, for media rows only.
  if (el.media === undefined) {
    const media = projectMedia(el);
    if (media) el.media = media;
  }
  // ...and then the RAW observation goes, both copies. It carries the URLs
  // `media` deliberately reduces to a digest — `src`, `srcset`, `<source>`
  // srcsets, a video `poster` — and the style gate uploads these rows as CI
  // artifacts from a public repository. vision-core never reads it.
  delete el.mediaMetadata;
  if (state) delete state.mediaMetadata;
  const mediaRec = asRecord(el.media);
  const tag = lowerTag(el);
  const kind =
    (typeof mediaRec?.kind === "string" ? mediaRec.kind : undefined) ??
    (tag !== undefined ? TAG_KINDS[tag] : undefined);

  // text — PAINTED text only: visible text, then state.textContent. Omit
  // empty. A media kind whose content is never painted carries no text at all
  // (see the doc comment above); the alt lives in `media.alt`.
  if (kind !== undefined && UNPAINTED_TEXT_KINDS.has(kind as MediaKind)) {
    delete el.text;
  } else if (el.text === undefined || el.text === null || el.text === "") {
    const candidate =
      (typeof el.text === "string" && el.text) ||
      (state && typeof state.textContent === "string" && state.textContent) ||
      "";
    const trimmed = candidate.trim();
    if (trimmed) el.text = trimmed;
    else if (el.text === "") delete el.text; // drop empty-string text
  }

  // role — el.role, then state.role. Omit absent.
  if (el.role === undefined || el.role === null || el.role === "") {
    const role =
      (typeof el.role === "string" && el.role) ||
      (state && typeof state.role === "string" && state.role) ||
      "";
    if (role) el.role = role;
    else if (el.role === "") delete el.role;
  }

  if (computed) {
    // fg_color / bg_color — only when not already present.
    if (el.fg_color === undefined) {
      const fg = parseCssColor(computed.color);
      if (fg) el.fg_color = fg;
    }
    if (el.bg_color === undefined) {
      const bg = parseCssColor(computed.backgroundColor);
      if (bg) el.bg_color = bg;
    }

    // font_size_px / line_height_px — px-resolvable only.
    if (el.font_size_px === undefined) {
      const fs = parsePx(computed.fontSize);
      if (fs !== null) el.font_size_px = fs;
    }
    if (el.line_height_px === undefined) {
      const lh = parsePx(computed.lineHeight);
      if (lh !== null) el.line_height_px = lh;
    }

    // font_family — NOT in computedStyles today; read defensively in case a
    // future SDK adds it. Omit when absent.
    if (
      el.font_family === undefined &&
      typeof (computed as Record<string, unknown>).fontFamily === "string"
    ) {
      const ff = (
        (computed as Record<string, unknown>).fontFamily as string
      ).trim();
      if (ff) el.font_family = ff;
    }

    // z_index is NEVER derived from `computedStyles.zIndex`. vision-core's
    // `z_index` is a GLOBAL paint rank (the element's position in the
    // document's resolved painting order), and its producer contract forbids
    // writing the CSS value into it: a CSS z-index is resolved inside its own
    // stacking context, so a `z-50` dropdown nested in a `z-10` title bar —
    // which really paints BELOW a `z-20` sibling panel — reads as on top, and
    // the occlusion verdict inverts silently. The snapshot carries only the
    // per-context CSS value, so the honest projection is none: the layout
    // analyzer then takes direction from `occluded_by` (the SDK's own
    // hit-test, carried below) and reports a pair it cannot direct as
    // `occlusion_unknown`. Coord finding 83b1e0d6.

    // text_overflow — sharpens the wording of a truncation finding
    // ("ellipsised" vs "clipped"). Never the verdict itself: the verdict
    // comes from scroll_width_px below, which is a measurement, whereas
    // this is only a declaration of what WOULD happen on overflow.
    if (el.text_overflow === undefined && typeof computed.textOverflow === "string") {
      const to = computed.textOverflow.trim();
      if (to) el.text_overflow = to;
    }
  }

  // visible / occluded_by — the SDK's own hit-test result, which is
  // ground truth about what a reader can actually see. Carried across
  // verbatim: it is the one signal here that geometry cannot reproduce
  // (clip-path, transformed ancestors, scroll clipping).
  if (state) {
    if (el.visible === undefined && typeof state.visible === "boolean") {
      el.visible = state.visible;
    }
    if (el.occluded_by === undefined && typeof state.occludedBy === "string") {
      el.occluded_by = state.occludedBy;
    }

    // scroll_width_px — laid-out content width. This is what makes
    // horizontal truncation measurable at all; `text_fits_container`
    // compared only heights before it existed, so every ellipsised label
    // passed. Emitted only when it EXCEEDS the box: an element whose
    // content fits carries no information here, and the Rust side treats
    // absence as "not measured", so writing equal values everywhere would
    // bloat every snapshot for nothing.
    if (el.scroll_width_px === undefined) {
      const sw = typeof state.scrollWidth === "number" ? state.scrollWidth : null;
      const cw = typeof state.clientWidth === "number" ? state.clientWidth : null;
      if (sw !== null && cw !== null && sw > cw) {
        el.scroll_width_px = Math.round(sw);
      }
    }
  }
}

/**
 * Enrich every element in an elements array in place. Skips non-object entries.
 */
export function enrichElements(elements: unknown[]): void {
  for (const el of elements) {
    const rec = asRecord(el);
    if (rec) enrichElement(rec);
  }
}

/**
 * Bbox-normalization adapter — the ONE shape transform between the web SDK's
 * snapshot and the Rust analyzer.
 *
 * WHY this exists:
 *   - The web UI-Bridge SDK emits each element's bbox as
 *     `{ x, y, width, height }` with FLOAT values
 *     (`ui-bridge/packages/ui-bridge/src/control/types.ts:454`).
 *   - The Rust analyzer's `Region`
 *     (`qontinui-schemas/rust-vision-core/src/frame.rs`) requires exactly
 *     `{ x, y, w, h }` — no serde aliases, no rename. A verbatim bbox
 *     therefore fails deserialization with `missing field 'w'`.
 *   - The Rust `Element`
 *     (`qontinui-schemas/rust-vision-core/src/element_snapshot.rs`) has NO
 *     `deny_unknown_fields` and only `id` is required (every other field is
 *     `#[serde(default)]`/Option, and the SDK always supplies `id`). So the
 *     SDK's extra fields are harmlessly ignored and `bbox` is the ONLY shape
 *     that must be transformed — nothing else is touched.
 *
 * Transform: for each element that HAS a bbox (bbox is optional — bbox-less
 * elements are left untouched, matching `Region`'s `Option`), replace
 * `{ x, y, width, height }` (floats) with `{ x, y, w, h }` (rounded ints).
 * A malformed/partial bbox (missing any of x/y/width/height, or a non-finite
 * value) is DROPPED rather than written as NaN — `bbox: Option<Region>` accepts
 * absence, and a NaN/partial Region would crash the analyzer's deserialize.
 * Every other field is left exactly as-is.
 *
 * SIGNS: `Region`'s ORIGIN (`x`/`y`) is `i32` — SIGNED — and the true
 * coordinate is emitted verbatim. `getBoundingClientRect()` legitimately
 * returns NEGATIVE x/y for elements scrolled or positioned off the top/left of
 * the viewport (a sticky header mid-scroll, an off-canvas drawer, a
 * `left:-9999px` a11y-hidden node), and that negative value is real geometry
 * the analyzer needs: clamping it to 0 used to report every off-screen element
 * as sitting flush against the viewport edge, fabricating overlaps against
 * whatever really lives at the origin and hiding genuine off-screen placement.
 * The EXTENT (`w`/`h`) is `u32` — UNSIGNED — because a negative width or
 * height is meaningless; the `Math.max(0, …)` on those two is a real
 * domain guard and stays.
 *
 * Mutates the elements in place (the caller re-serializes the same body).
 */
export function normalizeBboxes(elements: unknown[]): void {
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const record = el as Record<string, unknown>;
    if (!("bbox" in record)) continue; // bbox is optional — leave as-is.

    const bbox = record.bbox;
    if (!bbox || typeof bbox !== "object") {
      // Present but not an object -> malformed; drop so it can't crash the
      // analyzer (an Option<Region> tolerates absence).
      delete record.bbox;
      continue;
    }

    const { x, y, width, height } = bbox as {
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const vals = [x, y, width, height];
    const allFinite = vals.every(
      (v) => typeof v === "number" && Number.isFinite(v)
    );
    if (!allFinite) {
      // Missing or non-finite component -> drop rather than emit NaN.
      delete record.bbox;
      continue;
    }

    record.bbox = {
      // Signed origin — emit the TRUE coordinate, negatives included.
      x: Math.round(x as number),
      y: Math.round(y as number),
      // Unsigned extent — a negative w/h is meaningless, so floor at 0.
      w: Math.max(0, Math.round(width as number)),
      h: Math.max(0, Math.round(height as number)),
    };
  }
}
