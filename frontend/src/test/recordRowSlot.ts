/**
 * The class contract for optional content a consumer puts in a `RecordRow`
 * slot: it is revealed by the ROW's width (`@container/record-row`), never by
 * the viewport's. Shared by `components/console/recordRowSlots.test.ts` (the
 * source census over every `<RecordRow>`) and the per-consumer cases that
 * render each row and read the revealed element's classes.
 *
 * jsdom has no layout engine, so this is a CLASS contract; the geometry it
 * produces is an operated check [policy: testing/regression-is-retention-not-cadence].
 */

import { expect } from "vitest";

/**
 * A Tailwind VIEWPORT variant: `sm:` … `2xl:`, their `min-` and `max-` forms,
 * their `not-` negations (`not-sm:`, `not-max-md:`), and the arbitrary
 * `min-[…]:` / `max-[…]:` media forms and an arbitrary `[@media(…)]:` — at the start of a class or stacked
 * after another variant (`hover:sm:`). Every one of them compiles to a
 * `@media` rule in Tailwind 4.3.0. A container variant starts with `@`
 * (`@min-[45rem]/record-row:`), so it never matches.
 */
export const VIEWPORT_VARIANT =
  /(^|[\s:])((not-)?(min-|max-)?(sm|md|lg|xl|2xl)|(not-)?(min|max)-\[[^\]]*\]|\[@media[^\]]*\]):/;

/**
 * Asserts `el` is hidden by default and revealed by exactly `reveal` (for
 * example `@min-[45rem]/record-row:inline`), with no viewport variant
 * anywhere in its class list.
 */
export function expectRowKeyedReveal(el: HTMLElement, reveal: string): void {
  const classes = el.className.split(/\s+/);
  expect(classes).toContain("hidden");
  expect(classes).toContain(reveal);
  expect(el.className).not.toMatch(VIEWPORT_VARIANT);
}

/**
 * Asserts `el` is the item that gives up width before the row's label does —
 * `min-w-0 shrink-[999]` and truncating — so the label keeps its 12rem floor.
 */
export function expectYieldsBeforeLabel(el: HTMLElement): void {
  const classes = el.className.split(/\s+/);
  expect(classes).toEqual(
    expect.arrayContaining(["min-w-0", "shrink-[999]", "truncate"])
  );
}
