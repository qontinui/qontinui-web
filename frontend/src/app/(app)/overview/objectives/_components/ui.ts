/**
 * Class strings the Objectives page's pieces share, so a disclosure or a
 * notice looks the same wherever it appears. Overview idiom (plan
 * `2026-10-06-overview-objectives-view` D10): plain prose, semantic theme
 * tokens only, no literal colours.
 */

/** A `<summary>` that opens a disclosure. */
export const DISCLOSURE =
  "inline-flex min-h-9 cursor-pointer select-none items-center rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A plain link styled like the overview's other text links. */
export const TEXT_LINK =
  "inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A side-ruled notice: something the reader should know, not an error. */
export const NOTICE = "border-l-2 border-warning pl-4";

/** Muted secondary prose. */
export const MUTED = "text-sm leading-relaxed text-muted-foreground";

/** Serif headings, through the overview's own font variable. */
export const SERIF = "font-[family-name:var(--font-overview-serif)]";

/** An id segment safe inside a dotted UI Bridge id ("1.2" → "1-2"). */
export function bridgeSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "-");
}
