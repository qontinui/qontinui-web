/**
 * Every attribute under `root` (root included) whose value contains `needle`,
 * case-insensitively, as `<tag>[<attr>="<value>"]` lines — empty when none.
 *
 * Unlike `expectPresentationSafe`'s identity check, which reads text and the
 * text-bearing attributes (`title`, `aria-label`, …), this reads EVERY
 * attribute: `href`, `value`, `data-*` and the rest. A presentation test that
 * must prove a name is nowhere in the DOM uses both.
 */
export function attributesNaming(root: Element, needle: string): string[] {
  const lower = needle.trim().toLowerCase();
  if (!lower) return [];
  const out: string[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.toLowerCase().includes(lower)) {
        out.push(`${el.tagName.toLowerCase()}[${attr.name}="${attr.value}"]`);
      }
    }
  }
  return out;
}
