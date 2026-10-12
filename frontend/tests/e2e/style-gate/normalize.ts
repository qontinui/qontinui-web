/**
 * Style-gate snapshot normalizer (pure, unit-testable).
 *
 * Maps the web UI-Bridge `/control/snapshot` element shape into the fields the
 * Rust `vision-audit` analyzer's `Element` schema consumes
 * (qontinui-schemas/rust-vision-core/src/element_snapshot.rs). Kept as a
 * standalone, dependency-free module (no Playwright import) so it can be
 * exercised by a vitest unit test directly.
 *
 * MIRROR — `qontinui-claude-config/scripts/uibridge-to-elementsnapshot.py`
 * projects the runner's `/ui-bridge/control/discover` payload into the same
 * `Element` shape for targets this adapter structurally cannot reach (a Tauri
 * WebView has no URL to drive). That script's header says the duplication is
 * a KNOWN drift risk and that "a change to one belongs in the other"; this
 * comment is the other half of that declaration. The field decisions that
 * must stay in step are `deriveInteractable` / `derive_interactable`,
 * `inertReason` / `inert_reason`, `parseCssColor` / `parse_color`,
 * `parsePx` / `parse_px`, `parseOpacity` / `parse_opacity` and the bbox
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
 *   text          string               (visible text / textContent)
 *   role          string               (ARIA role)
 *   interactable  bool                 (real interactivity — default false)
 *   fg_color      { r, g, b } u8       (computed color)
 *   bg_color      { r, g, b } u8       (computed backgroundColor)
 *   font_size_px  f32                  (computed fontSize, px)
 *   font_family   string               (computed fontFamily, if present)
 *   line_height_px f32                 (computed lineHeight, px)
 */

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
 * `#rrggbbaa`) into `{ r, g, b }` (alpha dropped). Returns null for
 * transparent / `none` / unparseable / fully-transparent values — the caller
 * OMITS the field rather than guessing, matching the analyzer's
 * "skipped: missing X" contract.
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
    // A fully transparent color carries no visible foreground/background — omit.
    if (rgbMatch[4] !== undefined) {
      const rawAlpha = rgbMatch[4];
      const alpha = rawAlpha.endsWith("%")
        ? Number(rawAlpha.slice(0, -1)) / 100
        : Number(rawAlpha);
      if (Number.isFinite(alpha) && alpha === 0) return null;
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
    if (a === 0) return null;
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

/**
 * Enrich a single element record IN PLACE with the analyzer fields derived from
 * the SDK shape. Only sets a field when a real value is available — absent
 * fields are left unset so the Rust serde defaults apply. Pre-existing
 * analyzer-shaped fields on the element are NOT overwritten (a snapshot source
 * that already populated them wins).
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

  // text — visible text, then state.textContent. Omit empty.
  if (el.text === undefined || el.text === null || el.text === "") {
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

    // z_index — the analyzer's DIRECTION. Without it the layout analyzer
    // can see that two boxes intersect but not which one the reader
    // actually sees, so the strongest finding it can emit is the
    // symmetric "A and B overlap". `auto` is not 0: it means "this
    // element establishes no stacking context of its own", which is a
    // different claim, so it is left UNSET and the analyzer reports the
    // pair as `occlusion_unknown` rather than inventing an order.
    if (el.z_index === undefined) {
      const z = parseInt(String(computed.zIndex ?? ""), 10);
      if (Number.isFinite(z)) el.z_index = z;
    }

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
