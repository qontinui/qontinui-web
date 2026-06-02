/**
 * pageCatalog.ts
 *
 * Builds a compact, plain-text catalog of the qontinui-web app's REAL element
 * labels per page, plus the canonical list of co-pilot page ids. The runner's
 * planner is sent this catalog alongside the user's prompt so it emits
 * instructions using labels that actually exist on the page (e.g. "Create
 * Workflow") and page ids the executor can resolve to a URL — instead of
 * hallucinated names.
 *
 * Two data sources, both already present in the web app:
 *
 *  1. Page list — from `copilotPages` (see `./pageMap.ts`), which is derived
 *     from the shared navigation registry. This is the authoritative set of
 *     pages the planner may target; the SAME list seeds the executor's URL
 *     map, so a planner page id always resolves.
 *
 *  2. Element labels — from the runtime UI-Bridge spec store
 *     (`getGlobalSpecStore().getAll()` -> `Map<specId, SpecConfig>`). Specs are
 *     populated at runtime from the runner's Spec API (dev / runner-reachable
 *     origins only — see `src/lib/ui-bridge/discovered-specs.ts`). In a
 *     production browser with no runner reachable the store is empty; in that
 *     case the catalog still emits the page list so the planner has a valid
 *     page graph to target.
 *
 * Mirrors the intent of the runner's
 * `qontinui-runner/src/components/prompt-home/pageCatalog.ts` but is an
 * independent implementation (no cross-repo dependency) and caps the total
 * output at ~4000 chars to keep the planner prompt compact.
 */

import { getGlobalSpecStore } from "@qontinui/ui-bridge/specs";
import type {
  SpecConfig,
  SpecGroup,
  SpecAssertion,
} from "@qontinui/ui-bridge/specs";
import { copilotPages, type CopilotPage } from "./pageMap";

const MAX_LABELS_PER_GROUP = 6;
const MAX_GROUPS_PER_SPEC = 6;
/** Total catalog character budget — keeps the planner prompt compact. */
const MAX_CATALOG_CHARS = 4000;
const MAX_LABEL_CHARS = 60;

/**
 * Extract a human-readable label from a spec assertion's target. Prefers the
 * explicit `label`, then falls back to the target's identifying field
 * (elementId / ctr logical name / search text). Returns null when no usable
 * label is present.
 */
function extractLabel(assertion: SpecAssertion): string | null {
  const target = assertion.target;
  if (!target) return null;
  if (target.label) return target.label.trim();
  if (target.type === "elementId") return target.elementId;
  if (target.type === "ctr") return target.logicalName;
  if (target.type === "search") {
    const criteria = target.criteria as Record<string, unknown> | undefined;
    const text = (criteria?.textContent ??
      criteria?.text ??
      criteria?.ariaLabel) as string | undefined;
    if (text) return text.trim();
  }
  return null;
}

/** Truncate an over-long label so a single noisy assertion can't blow the budget. */
function clampLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS
    ? label.slice(0, MAX_LABEL_CHARS - 3) + "..."
    : label;
}

/**
 * Format one spec group as a single indented line of deduped labels, or null
 * if the group contributes no usable labels.
 */
function formatGroup(group: SpecGroup): string | null {
  const labels = new Set<string>();
  for (const assertion of group.assertions ?? []) {
    const label = extractLabel(assertion);
    if (label) labels.add(clampLabel(label));
    if (labels.size >= MAX_LABELS_PER_GROUP) break;
  }
  if (labels.size === 0) return null;
  return `  ${group.name}: ${Array.from(labels).join(", ")}`;
}

/** Format one spec (page) into a header line plus its group lines. */
function formatSpec(specId: string, config: SpecConfig): string {
  const lines: string[] = [];
  const header = config.description
    ? `${specId} — ${config.description.replace(/\s+/g, " ").slice(0, 140)}`
    : specId;
  lines.push(header);
  for (const group of (config.groups ?? []).slice(0, MAX_GROUPS_PER_SPEC)) {
    const line = formatGroup(group);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

/** Render the canonical page list as `- id: description` lines. */
function formatPageList(pages: CopilotPage[]): string {
  const lines = ["Pages (use these page ids when navigating):"];
  for (const page of pages) {
    lines.push(`- ${page.id}: ${page.description}`);
  }
  return lines.join("\n");
}

/**
 * Build the compact page catalog string for the planner.
 *
 * Layout:
 *   <page-list section>      — always present; ids the planner may target.
 *   <per-page element labels> — only the pages the spec store knows about;
 *                               omitted entirely when the store is empty
 *                               (e.g. production with no runner reachable).
 *
 * The whole result is bounded by `MAX_CATALOG_CHARS`; the page list is
 * emitted first (it is the load-bearing part) and element-label sections are
 * appended until the budget is exhausted.
 *
 * @param pages - Page list to advertise. Defaults to `copilotPages` (the
 *                nav-registry-derived set). Injectable for tests.
 */
export function buildPageCatalog(pages: CopilotPage[] = copilotPages): string {
  const sections: string[] = [];

  const pageList = formatPageList(pages);
  sections.push(pageList);
  let total = pageList.length;

  const store = getGlobalSpecStore();
  const all = store.getAll();
  if (all.size > 0) {
    for (const [specId, config] of all) {
      const section = formatSpec(specId, config);
      // +2 for the "\n\n" separator joined between sections.
      if (total + section.length + 2 > MAX_CATALOG_CHARS) break;
      sections.push(section);
      total += section.length + 2;
    }
  }

  return sections.join("\n\n");
}
