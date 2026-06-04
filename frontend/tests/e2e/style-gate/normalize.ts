/**
 * Style-gate snapshot normalizer (pure, unit-testable).
 *
 * Maps the web UI-Bridge `/control/snapshot` element shape into the fields the
 * Rust `vision-audit` analyzer's `Element` schema consumes
 * (qontinui-schemas/rust-vision-core/src/element_snapshot.rs). Kept as a
 * standalone, dependency-free module (no Playwright import) so it can be
 * exercised by a vitest unit test directly.
 *
 * SOURCE shape (per element from `/control/snapshot`, see
 * ui-bridge/packages/ui-bridge/src/server/handlers.ts `materializeElements`):
 *   {
 *     id, type, tagName, label, role, ariaLabel, accessibleName, text, title,
 *     identifier, state, actions?: string[], customActions?: string[],
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
    /^rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)(?:\s*[,/]\s*([0-9.%]+))?\s*\)$/,
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

/** Narrow an unknown to a plain record. */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Decide `interactable` from real interactivity signals (NOT mere presence of
 * text). Mirrors the SDK's own categorization where available, then falls back
 * to interactive tag/role:
 *   - category === 'interactive'           (the SDK's own classification), OR
 *   - a non-empty `actions` array          (registered handlers), OR
 *   - a non-empty `customActions` array    (registered custom handlers), OR
 *   - an interactive tagName, OR
 *   - an interactive ARIA role.
 * Plain content/containers (category 'content'/'media', no actions, non-
 * interactive tag/role) stay false.
 */
export function deriveInteractable(el: Record<string, unknown>): boolean {
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
    else if (el.text === "" ) delete el.text; // drop empty-string text
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
      const ff = ((computed as Record<string, unknown>).fontFamily as string).trim();
      if (ff) el.font_family = ff;
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
