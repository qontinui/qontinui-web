/**
 * The project's own description of itself, read from coord's intent prompt
 * documents (`product_intent`, `initiative`, `success_metric`,
 * `audience_profile`), turned into what the Summary page can honestly say.
 *
 * The one rule that matters: coord seeds every tenant with SKELETON intent
 * documents. A skeleton is a template nobody has filled in, not the project's
 * intent, so the Summary must say "not written yet" rather than show it as if
 * it were real content.
 */

import type {
  PromptDocument,
  PromptDocumentKind,
  PromptDocumentSummary,
} from "@/app/(app)/admin/coord/prompt-documents/types";

/** A list or get row, with coord's served skeleton verdict where it has one. */
export type WithSeedVerdict<T> = T & { unedited_seed?: boolean | null };

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
 * The authority is the document's own `attrs.overview_order`, set through the
 * existing prompt-document write door; this list only keeps the seeded corpus
 * sensible until one is set.
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
 */
export type IntentState = "authored" | "skeleton" | "unknown";

/**
 * Coord's served verdict when present (`unedited_seed`), otherwise the
 * version/origin fallback coord documents for builds that predate it:
 * a hand-authored document is authored, a seeded one never edited past v1 is
 * a skeleton, and a seeded one edited since is UNKNOWN — never guessed.
 */
export function classifyIntent(
  doc: Pick<PromptDocument, "default_source" | "current_version"> & {
    unedited_seed?: boolean | null;
  }
): IntentState {
  if (typeof doc.unedited_seed === "boolean") {
    return doc.unedited_seed ? "skeleton" : "authored";
  }
  if (doc.default_source === null) return "authored";
  if (doc.current_version <= 1) return "skeleton";
  return "unknown";
}

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
  kind: SummaryIntentKind;
  name: string;
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
  // heading would DELETE that first line from the body.
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
 * `attrs.overview_order`, when the operator has set one.
 *
 * Only the GET-one shape carries `attrs` — coord's list rows never do — so a
 * skeleton or unreadable entry, built from a list row, always reads `null`.
 * Coord replaces `attrs` wholesale on write, so anything setting this key
 * must merge the stored object first.
 */
function readOrder(doc: Partial<Pick<PromptDocument, "attrs">>): number | null {
  const attrs = doc.attrs;
  if (!attrs || typeof attrs !== "object") return null;
  const value = (attrs as Record<string, unknown>).overview_order;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function base(
  doc: WithSeedVerdict<PromptDocumentSummary> &
    Partial<Pick<PromptDocument, "attrs">>
): Omit<IntentEntry, "state" | "body" | "title" | "hasBody"> {
  return {
    kind: doc.kind as SummaryIntentKind,
    name: doc.name,
    updatedAt: doc.updated_at ?? null,
    order: readOrder(doc),
  };
}

/**
 * Sort one kind's documents into reading order: the kind's stated order
 * first, then anything else by title. Deterministic either way — coord's own
 * ordering is alphabetical by slug, which is not an editorial judgement.
 */
export function sortIntentEntries(entries: IntentEntry[]): IntentEntry[] {
  // Per KIND, one authority decides: if any of its documents carries an
  // operator-set order, that is the order for that kind and its unordered
  // documents follow. Mixing the two would let an order set on one document
  // ("2", meaning second) outrank the whole fallback list and put it first.
  const operatorOrdered = new Set(
    entries.filter((e) => e.order !== null).map((e) => e.kind)
  );
  const rank = (e: IntentEntry) => {
    if (operatorOrdered.has(e.kind)) {
      return e.order ?? Number.MAX_SAFE_INTEGER;
    }
    const i = (INTENT_DOC_ORDER[e.kind] ?? []).indexOf(e.name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...entries].sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, "en")
  );
}

/** A document whose body was fetched. */
export function toIntentEntry(
  doc: WithSeedVerdict<PromptDocument>
): IntentEntry {
  const state = classifyIntent(doc);
  const body = doc.body ?? "";
  return {
    ...base(doc),
    state,
    title: titleOfDocument(doc.name, body),
    hasBody:
      state === "skeleton" ? false : stripFrontmatter(body).trim().length > 0,
    body: state === "skeleton" ? "" : bodyWithoutLeadHeading(body),
  };
}

/** A document the list row already shows is an unedited skeleton, so its
 *  template body is never fetched. */
export function skeletonEntry(
  doc: WithSeedVerdict<PromptDocumentSummary>
): IntentEntry {
  return {
    ...base(doc),
    state: "skeleton",
    body: "",
    hasBody: false,
    title: titleOfDocument(doc.name, ""),
  };
}

/** A document the list named but whose body could not be read. */
export function unreadableEntry(
  doc: WithSeedVerdict<PromptDocumentSummary>,
  error: string
): IntentEntry {
  return {
    ...base(doc),
    state: "unreadable",
    body: "",
    hasBody: false,
    error,
    title: titleOfDocument(doc.name, ""),
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
