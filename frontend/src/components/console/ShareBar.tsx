"use client";

/**
 * ShareBar / ShareList — a part of a whole, as a glyph, and a ranked
 * distribution of such parts.
 *
 * **Recorded under §6.4** in `frontend/docs/console-ui-style-guide.md`
 * §3.7: the guide's primitives had no share, percentage or ranked-distribution
 * concept at all (`RecordRow`'s slots are identity/label/status/reason/time),
 * and plan `2026-08-27-operator-touch-read-and-surface` Phase C3 needed one for
 * the operator-touch page's strategic aggregate — *"these four classes are 60%
 * of my interruptions"*. §6.4 allows exactly two options, compose or extend in
 * the same PR; this is the extension.
 *
 * Three rules the primitives hold so a caller cannot get them wrong:
 *
 * 1. **The number is formatted by `./share.ts`**, the console's one
 *    part-of-a-whole formatter: exact `100%`/`0%` only at the exact ends, `>`/`<`
 *    hedges between, and the unknown dash `–` for a share over nothing (R6).
 * 2. **The bar is NEUTRAL, never an attention hue.** A share is a measurement
 *    of the whole surface, not a statement about whose move a row is (R3); a
 *    red bar on "the biggest class" would spend the loudest signal on "big".
 *    An UNKNOWN share draws an empty dashed track, never an empty solid one —
 *    an empty solid track reads as a measured 0.
 * 3. **`ShareList` ranks by count itself** (descending, stable on ties, an
 *    unknown count last), so the order is a property of the primitive rather
 *    than a hope about the caller's input. Its lines are NOT buttons: an
 *    aggregate is read, not acted on per line — a per-line action is what
 *    R5's `RecordRow` is for.
 *
 * Presentation only — no fetch, no route (see the barrel's doc).
 */

import type { ReactNode } from "react";
import { shareOfFraction } from "./share";

export interface ShareBarProps {
  /** The part. `null` = unknown. */
  numerator: number | null;
  /** The whole. `null`, zero or negative = unknown (no share over nothing). */
  denominator: number | null;
  /** Native tooltip; defaults to "`n` of `d`". */
  title?: string;
  className?: string;
  "data-testid"?: string;
}

/** The fill fraction for a KNOWN share, else `null`. */
export function shareFraction(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0 || numerator < 0 || numerator > denominator) return null;
  return numerator / denominator;
}

export function ShareBar({
  numerator,
  denominator,
  title,
  className,
  "data-testid": testId,
}: ShareBarProps) {
  const fraction = shareFraction(numerator, denominator);
  const text = shareOfFraction(fraction);
  return (
    <span
      className={["inline-flex items-center gap-2 shrink-0", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      title={
        title ??
        (fraction === null
          ? "no share can be stated — the whole is unknown or empty"
          : `${numerator} of ${denominator}`)
      }
      data-testid={testId}
      data-share-known={fraction === null ? "false" : "true"}
    >
      <span
        aria-hidden
        className={[
          "relative inline-block h-1.5 w-16 overflow-hidden rounded-full",
          fraction === null
            ? "border border-dashed border-muted-foreground/40"
            : "bg-muted",
        ].join(" ")}
      >
        {fraction !== null && fraction > 0 && (
          <span
            className="absolute inset-y-0 left-0 min-w-[2px] rounded-full bg-foreground/55"
            style={{ width: `${fraction * 100}%` }}
          />
        )}
      </span>
      <span className="w-[6ch] text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {text}
      </span>
    </span>
  );
}

export interface ShareListItem {
  /** React key and the line's stable identity (`data-share-key`). */
  key: string;
  /** Human label — R8: never the wire enum. Truncates; its `title` is `title`. */
  label: ReactNode;
  /**
   * This line's part of the whole. `null` = coord sent no usable count: the
   * line says `unknown`, its bar is the dashed unknown track, and it ranks
   * after every known line — never a `0`, which would assert a measured
   * absence.
   */
  count: number | null;
  /** Full-text tooltip for the label (the wire token belongs here, not on screen). */
  title?: string;
  /** Short secondary text, shown from `sm` up (e.g. a per-line split). */
  detail?: ReactNode;
  /**
   * Tooltip for the detail, which truncates at 28ch — so what the ellipsis
   * cuts stays reachable. Defaults to the detail's own text when that is a
   * string. Separate from `title` on purpose: a caller's `title` can be a wire
   * token (R8) that names the LABEL, and must not reappear on the detail.
   */
  detailTitle?: string;
  "data-testid"?: string;
}

export interface ShareListProps {
  items: ShareListItem[];
  /**
   * The whole every line is a share of. `null` = unknown, and every line then
   * shows the dashed track and `–` rather than a share over a guessed total.
   */
  total: number | null;
  /** Rendered when there are no items. The caller's words — name the question. */
  empty?: ReactNode;
  /**
   * What the count counts, rendered after it (`30 placed`). A bare number
   * beside a name is ambiguous by construction (served policy `ux-priorities`
   * `a-label-names-one-referent-and-a-quantity-names-its-unit`); pass this
   * unless the list's heading already names the unit.
   */
  unit?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * `items`, ranked by count descending, stable on ties, with an unknown
 * (`null`) count after every known one. Pure.
 */
export function rankShares<T extends { count: number | null }>(
  items: T[]
): T[] {
  const rank = (c: number | null) =>
    c === null ? Number.NEGATIVE_INFINITY : c;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = rank(a.item.count);
      const rb = rank(b.item.count);
      return ra === rb ? a.index - b.index : rb > ra ? 1 : -1;
    })
    .map(({ item }) => item);
}

export function ShareList({
  items,
  total,
  empty,
  unit,
  className,
  "data-testid": testId,
}: ShareListProps) {
  if (items.length === 0) {
    return <>{empty ?? null}</>;
  }
  return (
    <ol
      className={["space-y-1", className ?? ""].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      {rankShares(items).map((item) => (
        <li
          key={item.key}
          data-share-key={item.key}
          data-testid={item["data-testid"]}
          className="flex items-center gap-3 rounded-md border border-border bg-card/30 px-3 py-1.5 text-sm"
        >
          <span className="min-w-0 flex-1 truncate" title={item.title}>
            {item.label}
          </span>
          {item.detail != null && (
            <span
              className="hidden sm:inline shrink-0 truncate max-w-[28ch] text-xs text-muted-foreground"
              title={
                item.detailTitle ??
                (typeof item.detail === "string" ? item.detail : undefined)
              }
            >
              {item.detail}
            </span>
          )}
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
            data-share-count={item.count === null ? "unknown" : item.count}
          >
            {item.count === null
              ? "unknown"
              : unit
                ? `${item.count} ${unit}`
                : item.count}
          </span>
          <ShareBar numerator={item.count} denominator={total} />
        </li>
      ))}
    </ol>
  );
}
