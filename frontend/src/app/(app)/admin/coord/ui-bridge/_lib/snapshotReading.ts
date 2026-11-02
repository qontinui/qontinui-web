/**
 * The live element snapshot's structure — the pure derivation the "Live
 * element snapshot" panel renders (style guide R8): which element types the
 * runner's window holds, and how many of each.
 *
 * The snapshot (`GET /ui-bridge/control/snapshot`, the digital twin's
 * `useRunnerSnapshot`) carries each element's `type` from the SDK's own
 * classification (`button`, `input`, `link`, …). Only the TYPE is read here:
 * an element's label and content quote the window, which can name a session
 * or a client, so they stay in the operator's raw view.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** What an element with no readable `type` is counted as — counted, never dropped. */
export const UNTYPED_ELEMENT = "untyped";

export interface ElementTypeCount {
  readonly type: string;
  readonly count: number;
}

/**
 * Elements per `type`, most first and ties alphabetical. An entry that is not
 * an element object, or carries no non-blank string `type`, counts as
 * {@link UNTYPED_ELEMENT}, so the counts always sum to the elements read.
 */
export function elementTypeCounts(
  elements: readonly unknown[]
): ElementTypeCount[] {
  const counts = new Map<string, number>();
  for (const el of elements) {
    const type =
      isRecord(el) && typeof el.type === "string" && el.type.trim()
        ? el.type.trim()
        : UNTYPED_ELEMENT;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
