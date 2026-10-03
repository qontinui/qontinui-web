/**
 * The kit's three-way merge: my working copy, rebuilt on THEIR version, field
 * by field, against the version mine was built on (`base`).
 *
 * - a field I did not change takes theirs — a peer may well have changed it,
 *   and putting my stale copy of it back is a lost update;
 * - a field I changed and they did not (or they changed to the same value)
 *   keeps mine;
 * - a field we BOTH changed, to different values, keeps mine in `merged` and
 *   is listed in `both`: nothing can say which is right, so the writer must
 *   choose, and a caller that saves without asking ("save mine over theirs")
 *   does so knowingly.
 *
 * Values are compared by their JSON, so arrays and objects (a table's rows)
 * compare by content.
 */

export interface ThreeWay<T, K extends keyof T = keyof T> {
  merged: T;
  /** Fields only I changed: what saving `merged` over theirs writes. */
  mineOnly: K[];
  /** Fields we both changed to different values: the writer's choice. */
  both: K[];
}

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function threeWayMerge<T extends object, K extends keyof T>(
  base: T,
  mine: T,
  theirs: T,
  keys: readonly K[]
): ThreeWay<T, K> {
  const merged = { ...theirs };
  const mineOnly: K[] = [];
  const both: K[] = [];
  for (const key of keys) {
    if (sameValue(mine[key], base[key])) continue; // untouched: theirs
    merged[key] = mine[key];
    if (sameValue(theirs[key], base[key])) mineOnly.push(key);
    else if (!sameValue(theirs[key], mine[key])) both.push(key);
  }
  return { merged, mineOnly, both };
}
