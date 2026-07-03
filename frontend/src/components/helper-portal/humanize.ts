/**
 * Humanize preset reason codes for the helper portal.
 *
 * Helpers are non-technical: reason codes like `text_cut_off` must render as
 * plain language ("Text is cut off"), never as snake_case jargon. Known codes
 * get curated phrasings; unknown codes fall back to a generic
 * underscores-to-words conversion so a new coord-side code never renders raw.
 */

const KNOWN_REASONS: Record<string, string> = {
  text_cut_off: "Text is cut off",
  overlapping: "Things overlap each other",
  wrong_color: "The colors look wrong",
  button_missing: "A button is missing",
  too_small: "Something is too small to read",
  misaligned: "Things look out of place",
  blank_area: "Part of the screen is blank",
  broken_image: "A picture is broken or missing",
};

/** Render a preset reason code as friendly, plain language. */
export function humanizeReason(code: string): string {
  const known = KNOWN_REASONS[code];
  if (known) return known;
  const words = code.replace(/[_-]+/g, " ").trim();
  if (!words) return code;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
