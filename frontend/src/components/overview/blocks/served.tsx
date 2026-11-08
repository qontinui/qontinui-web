/**
 * Text a report block shows, as the server served it (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D4,
 * D5).
 *
 * ## The withheld marker
 *
 * The server serves a string that names one of the project's confidential
 * terms — added after the string was written — as exactly
 * {@link WITHHELD_MARKER}, and lists the slot it withheld (the `WITHHELD`
 * constant in `backend/app/overview/report_snapshot_contract.py`). That covers
 * a report's title, summary and body, its source fields, and any string of a
 * snapshot. The marker is a SIGNAL, not content: shown as written, it reads
 * like a broken template. {@link Served} turns it into a plain-language
 * notice instead — never a blank, and never the marker itself — and
 * {@link servedText} does the same for text bound for an attribute.
 *
 * Confidentiality itself is the server's (D4): this does not redact anything.
 * It only says, in words, that the server did.
 *
 * ## Unknown is not zero
 *
 * A value the snapshot did not measure is `null` with a reason, and
 * {@link NotMeasured} says "not measured — <reason>": never `0`, a dash or a
 * blank.
 */

import { cn } from "@/lib/utils";

/** What a withheld string is served as (the backend's `WITHHELD`). */
export const WITHHELD_MARKER = "[withheld]";

/** The notice that stands in for a withheld string. */
export const WITHHELD_WORD = "Withheld";

/** Why, in a sentence, for a tooltip and screen-reader text. */
export const WITHHELD_REASON =
  "This text was withheld because it names something this project keeps confidential.";

export function isWithheld(text: string | null | undefined): boolean {
  return text === WITHHELD_MARKER;
}

/** `text` for an attribute (a title, an aria-label): the notice's word in
 *  place of the marker. */
export function servedText(text: string): string {
  return isWithheld(text) ? WITHHELD_WORD : text;
}

/** A served string, or the plain-language notice that it was withheld. */
export function Served({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (isWithheld(text)) {
    return (
      <span
        className={cn("italic text-muted-foreground", className)}
        title={WITHHELD_REASON}
        data-withheld=""
      >
        {WITHHELD_WORD}
        <span className="sr-only">: {WITHHELD_REASON}</span>
      </span>
    );
  }
  return className ? <span className={className}>{text}</span> : <>{text}</>;
}

/**
 * "not measured — <reason>". `compact` shows only "not measured" and keeps the
 * reason in the tooltip and in screen-reader text, for a table cell (D3
 * `report-scorecard`); either way the reason is in the element's text.
 */
export function NotMeasured({
  reason,
  compact = false,
  className,
}: {
  reason: string | null;
  compact?: boolean;
  className?: string;
}) {
  const why = reason?.trim() ? reason : "no reason was given";
  return (
    <span
      className={cn("text-muted-foreground", className)}
      title={compact ? servedText(why) : undefined}
      data-not-measured=""
    >
      not measured
      {compact ? (
        <span className="sr-only">
          {" — "}
          <Served text={why} />
        </span>
      ) : (
        <>
          {" — "}
          <Served text={why} />
        </>
      )}
    </span>
  );
}
