/** Shared formatting helpers for the policy-edit review feed. */

/**
 * Render an ISO-8601 timestamp in the viewer's locale, falling back to the raw
 * string when it cannot be parsed — an unreadable timestamp is shown as-is
 * rather than as a confident "Invalid Date".
 */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * `"1 write"` / `"3 writes"` — the same construction the backend's `_plural`
 * spells (`operations.py`), so the two surfaces' sentences count alike.
 *
 * Named rather than repeated inline: the landed-write feed now builds three
 * sentences from independent counts, and a count that reads "1 writes" in one
 * of them is the kind of thing a reader trusts less than it deserves.
 */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
