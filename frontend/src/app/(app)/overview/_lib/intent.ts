/**
 * The project's own description of itself, read from coord's intent prompt
 * documents (`product_intent`, `initiative`, `success_metric`,
 * `audience_profile`), turned into what the Summary page can honestly say.
 *
 * The documents arrive through the overview's `intent-documents` resource
 * (plan `2026-09-20-overview-authoring-layer`), which has already done two
 * things this file used to: classified each document (`state`) and split off
 * its YAML frontmatter, so `body` is prose.
 *
 * The one rule that matters: coord seeds every tenant with SKELETON intent
 * documents. A skeleton is a template nobody has filled in, not the project's
 * intent, so the Summary must say "not written yet" rather than show it as if
 * it were real content.
 */

import type { PromptDocumentKind } from "@/app/(app)/admin/coord/prompt-documents/types";

/**
 * One intent document as the `intent-documents` resource serves it
 * (`IntentDocumentRead`, `backend/app/overview/intent_documents.py`).
 */
export interface IntentDocument {
  /** `<kind>:<name>`. */
  id: string;
  kind: string;
  name: string;
  description: string | null;
  /** Prose — the frontmatter is served apart and never edited here. */
  body: string;
  frontmatter: string | null;
  /** The document's position in its section, 1-based; null = default. */
  overview_order: number | null;
  state: IntentState | "unreadable";
  error: string | null;
  status: string | null;
  withdrawn: boolean;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
}

/** The intent kinds the Summary shows, in page order. */
export const SUMMARY_INTENT_KINDS = [
  "product_intent",
  "initiative",
  "success_metric",
  "audience_profile",
] as const satisfies readonly PromptDocumentKind[];

export type SummaryIntentKind = (typeof SUMMARY_INTENT_KINDS)[number];

/**
 * Reading order within a kind, for coord's SEEDED document names only.
 *
 * Coord lists documents alphabetically by name (`ORDER BY kind, name`), which
 * put "non-goals" above "vision" on the Summary — the first thing a reader met
 * was what the project will never be (operator, 2026-09-21). Reading order is
 * editorial, so the page states one.
 *
 * **This list is a fallback, not the authority.** Coord documents these names
 * as the addresses of example rows an operator is expected to rename or
 * replace, so an order keyed on them silently stops applying after a rename.
 * The authority is the document's own `attrs.overview_order`, set by the
 * Summary's own "Move up / Move down" (or any caller of the resource); this
 * list only keeps the seeded corpus sensible until one is set.
 */
export const INTENT_DOC_ORDER: Record<SummaryIntentKind, readonly string[]> = {
  product_intent: ["vision", "non-goals", "open-questions"],
  initiative: ["current-initiative"],
  success_metric: [],
  audience_profile: [],
};

/**
 * - `authored`: someone wrote or edited this document; show it.
 * - `skeleton`: the unedited template coord ships; show "not written yet".
 * - `unknown`: edited at least once but still carries a template origin, and
 *   this coord build serves no verdict — the body alone decides, which this
 *   page does not attempt. Shown, with a note that it may still be template
 *   text.
 *
 * Decided server-side (`_state` in `intent_documents.py`), from coord's
 * `unedited_seed` verdict or, on a coord that serves none, its version and
 * origin.
 */
export type IntentState = "authored" | "skeleton" | "unknown";

/**
 * Drop a leading YAML frontmatter block (`---` … `---`). It is metadata for
 * coord and the agents that read these documents, not prose for a reader.
 */
export function stripFrontmatter(body: string): string {
  const match = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    body
  );
  return match ? body.slice(match[0].length).trimStart() : body;
}

export interface IntentEntry {
  /** The resource id, `<kind>:<name>`. */
  id: string;
  kind: SummaryIntentKind;
  name: string;
  /** The version a save must name. */
  version: number;
  /** The prose as stored, opening heading included — what an editor edits.
   *  Empty for a skeleton, whose template text is never offered as a start. */
  source: string;
  updatedBy: string | null;
  /** What to call this document on the page: its own opening heading. */
  title: string;
  /** `attrs.overview_order` when the operator has set one. */
  order: number | null;
  /**
   * Whether the document had prose BEFORE its opening heading was stripped.
   * A document that is only a title still says something — its title — and
   * must not be reported as unwritten.
   */
  hasBody: boolean;
  /** `unreadable`: the list named this document but its body failed to load. */
  state: IntentState | "unreadable";
  /** Readable markdown, frontmatter removed. Empty unless authored/unknown. */
  body: string;
  updatedAt: string | null;
  /** The load error, for `unreadable` only. */
  error?: string;
}

/**
 * The heading a document OPENS with — ATX (`# Title`) or setext (`Title` over
 * `====`) — or null when it opens with anything else.
 *
 * Anchored at the first non-blank line on purpose. A scan would find a `#`
 * comment inside a fenced code block, and would disagree with
 * `bodyWithoutLeadHeading`, which strips only from the start; the two must
 * name the same heading or the title renders twice.
 */
function leadHeading(
  body: string
): { text: string; raw: string; stripped: string } | null {
  const stripped = stripFrontmatter(body);
  const atx =
    /^([ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*)(?:\r?\n|$)/.exec(
      stripped
    );
  if (atx?.[2]) return { text: atx[2].trim(), raw: atx[0], stripped };
  // `=` only. A `-` underline is indistinguishable from a thematic break
  // after a block quote, a list item or an HTML block, and treating one as a
  // heading would DELETE that first line from the body. The guard below
  // rejects those openers outright, since none of them can carry a setext
  // underline in CommonMark.
  // Also `\``/`~` (a code fence) and `[` (a footnote or link definition):
  // none can carry a setext underline, and eating one deletes a line.
  if (/^[ \t]{0,3}(?:[>|<#`~[]|[-*+][ \t]|\d+[.)][ \t])/.test(stripped)) {
    return null;
  }
  const setext =
    /^([ \t]{0,3}(\S.*?)[ \t]*\r?\n[ \t]{0,3}={2,}[ \t]*)(?:\r?\n|$)/.exec(
      stripped
    );
  if (setext?.[2]) return { text: setext[2].trim(), raw: setext[0], stripped };
  return null;
}

/**
 * A heading read as words: `*Vision*`, `[Vision](/v)`, `` `vision` ``.
 *
 * Only DELIMITING markers are removed. `_` is left alone entirely: these
 * documents are largely about snake_case coord fields (`new_work_bar`,
 * `in_scope`, `source_query`), and stripping it turned a title like
 * "new_work_bar adherence" into "newworkbar adherence".
 */
function plainText(text: string): string {
  const words = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|[\s(])([*`]+)(?=\S)/g, "$1")
    .replace(/(\S)([*`]+)(?=[\s).,;:!?]|$)/g, "$1")
    .trim();
  // A "title" of pure punctuation ("# ***") is not a title. Returning ""
  // keeps `titleOfDocument` and `bodyWithoutLeadHeading` agreeing: the slug
  // names the document and the line stays in the body.
  return /[\p{L}\p{N}]/u.test(words) ? words : "";
}

/**
 * A document's own name for itself, taken from the heading it opens with
 * ("# Vision — the autonomy ratchet"), falling back to its slug read as words.
 *
 * NOT `description`: coord's descriptions are editorial notes for whoever
 * maintains the document ("Read to RULE A CANDIDATE OUT…"), often several
 * lines long, and using one as a heading put a paragraph where a title
 * belongs and buried the document's real title beneath it.
 */
export function titleOfDocument(name: string, body: string): string {
  const heading = leadHeading(body);
  const fromBody = heading ? plainText(heading.text) : "";
  if (fromBody) return fromBody;
  // Fallback, for a document that opens with prose or could not be read. A
  // slug's hyphen is usually a word separator ("current-initiative"), so it
  // becomes a space; that spells a genuinely hyphenated name slightly wrong
  // ("non-goals" → "Non goals"), which is the lesser of the two errors and
  // only shows when the document carries no heading of its own.
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The body with its opening heading removed, since the page renders that
 *  heading itself as the document's title. */
export function bodyWithoutLeadHeading(body: string): string {
  const heading = leadHeading(body);
  if (!heading) return stripFrontmatter(body);
  // A heading made only of markers ("# ***") yields no title, so the page
  // never renders it — leave it in the body rather than delete it.
  if (!plainText(heading.text)) return heading.stripped;
  return heading.stripped.slice(heading.raw.length).trimStart();
}

/**
 * Reading order for one kind's documents.
 *
 * `attrs.overview_order` is a POSITION, 1-based: "2" means second in the
 * section, which is what an operator reading the page means by it. So the
 * documents nobody has ruled on keep their default order among themselves,
 * and each ordered document is inserted at the position it names.
 *
 * Ranking the two against each other on one numeric axis cannot express
 * that — whichever band wins, setting "2" on a single document moves it to
 * the top, which is the complaint this file exists to fix, arriving through
 * the control added to fix it.
 */
function sortOneKind(entries: IntentEntry[]): IntentEntry[] {
  const seeded = (e: IntentEntry) => {
    const i = (INTENT_DOC_ORDER[e.kind] ?? []).indexOf(e.name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const byDefault = (a: IntentEntry, b: IntentEntry) =>
    seeded(a) - seeded(b) || a.title.localeCompare(b.title, "en");

  const placed = entries
    .filter((e) => e.order !== null)
    .sort((a, b) => a.order! - b.order! || byDefault(a, b));
  const rest = entries.filter((e) => e.order === null).sort(byDefault);

  // Front to back: a position is relative to the FINAL list, so earlier
  // positions must be in place before later ones are measured. Documents
  // SHARING a position go in one after another, keeping the order
  // `byDefault` computed, rather than each landing on the same index and
  // reversing the group.
  let lastOrder: number | null = null;
  let lastAt = -1;
  for (const entry of placed) {
    const wanted = Math.min(Math.max((entry.order ?? 1) - 1, 0), rest.length);
    // 1-based and clamped: position 0 or negative reads as "first", a
    // position past the end as "last".
    const at =
      entry.order === lastOrder ? Math.min(lastAt + 1, rest.length) : wanted;
    rest.splice(at, 0, entry);
    lastOrder = entry.order;
    lastAt = at;
  }
  return rest;
}

export function sortIntentEntries(entries: IntentEntry[]): IntentEntry[] {
  const byKind = new Map<SummaryIntentKind, IntentEntry[]>();
  for (const entry of entries) {
    const bucket = byKind.get(entry.kind);
    if (bucket) bucket.push(entry);
    else byKind.set(entry.kind, [entry]);
  }
  return [...byKind.values()].flatMap(sortOneKind);
}

/** One served document, as the Summary shows it. */
export function toIntentEntry(doc: IntentDocument): IntentEntry {
  const state = doc.state;
  // A skeleton fetched one at a time still carries its template text; the
  // page never shows it, and never offers it as a starting point either.
  const prose = state === "skeleton" || state === "unreadable" ? "" : doc.body;
  return {
    id: doc.id,
    kind: doc.kind as SummaryIntentKind,
    name: doc.name,
    version: doc.version,
    source: prose,
    updatedBy: doc.updated_by,
    updatedAt: doc.updated_at,
    order: doc.overview_order,
    state,
    title: titleOfDocument(doc.name, prose),
    hasBody: stripFrontmatter(prose).trim().length > 0,
    body: bodyWithoutLeadHeading(prose),
    ...(state === "unreadable" ? { error: doc.error ?? "" } : {}),
  };
}

/** True when an entry has something to show a reader: real text, or a load
 *  failure that must be reported rather than read as "not written". */
export function hasContent(entry: IntentEntry): boolean {
  if (entry.state === "unreadable") return true;
  if (entry.state === "skeleton") return false;
  // Measured BEFORE the opening heading was stripped: a document that is only
  // a title still says something, and is not "not written yet".
  return entry.hasBody;
}

/**
 * The position writes that move one document within its section.
 *
 * Every document shown gets an explicit position, 1..n, in the new order —
 * not just the one that moved. A single write would be read against the
 * DEFAULT order of the others (see `sortOneKind`), and a neighbour that
 * already holds the same position would tie with it, so "move down" could
 * leave the page unchanged. Only the documents whose position actually
 * changes are returned, so a move writes as little as it can.
 */
export function positionsAfterMove(
  section: readonly IntentEntry[],
  from: number,
  to: number
): { entry: IntentEntry; order: number }[] {
  if (from === to || to < 0 || to >= section.length) return [];
  const next = [...section];
  const [moved] = next.splice(from, 1);
  if (!moved) return [];
  next.splice(to, 0, moved);
  return next
    .map((entry, i) => ({ entry, order: i + 1 }))
    .filter(({ entry, order }) => entry.order !== order);
}
