/**
 * The plain-language rule as an executable check (plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, D6): the
 * text a reader sees on an overview page holds no identifier and no raw state
 * name. Technical detail lives in a `[data-provenance-detail]` disclosure and
 * is exempt; everything else is read.
 *
 * Used by tests; it takes a DOM subtree so it checks what was rendered, not
 * what the components were meant to render.
 */

/** Patterns that must not appear in visible text outside a disclosure. */
export const FORBIDDEN_IN_BODY: readonly { name: string; pattern: RegExp }[] = [
  { name: "uuid prefix", pattern: /[0-9a-f]{8}-/ },
  { name: "pull request number", pattern: /#\d+/ },
  { name: "in_progress", pattern: /in_progress/ },
  { name: "work-unit", pattern: /work-unit/ },
];

/** Visible text of `root`, with every provenance disclosure removed. */
export function bodyText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[data-provenance-detail]")
    .forEach((node) => node.remove());
  return clone.textContent ?? "";
}

/** The names of the rules `root`'s body text breaks; empty when it is clean. */
export function plainLanguageViolations(root: HTMLElement): string[] {
  const text = bodyText(root);
  return FORBIDDEN_IN_BODY.filter((r) => r.pattern.test(text)).map(
    (r) => r.name
  );
}
