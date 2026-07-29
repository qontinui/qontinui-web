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
