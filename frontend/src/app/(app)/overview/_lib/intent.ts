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
 * Document order within a kind, most important first.
 *
 * A kind holds several documents and coord lists them alphabetically by name,
 * which put "non-goals" above "vision" on the Summary — the first thing a
 * reader met was what the project will never be (operator, 2026-09-21).
 * Reading order is editorial, so it is stated here: what the project IS, then
 * what bounds it, then what is unsettled. A name not listed sorts after the
 * listed ones, by title.
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
  /** Coord's one-line description of the document, if it has one. */
  description: string | null;
  /** What to call this document on the page: its own opening heading. */
  title: string;
  /** `unreadable`: the list named this document but its body failed to load. */
  state: IntentState | "unreadable";
  /** Readable markdown, frontmatter removed. Empty unless authored/unknown. */
  body: string;
  updatedAt: string | null;
  /** The load error, for `unreadable` only. */
  error?: string;
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
  const heading = /^[ \t]{0,3}#{1,3}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(
    stripFrontmatter(body)
  );
  const fromBody = heading?.[1]?.trim();
  if (fromBody) return fromBody;
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The body with its opening heading removed, since the page renders that
 *  heading itself as the document's title. */
export function bodyWithoutLeadHeading(body: string): string {
  const stripped = stripFrontmatter(body);
  return stripped
    .replace(/^[ \t]{0,3}#{1,3}[ \t]+.+?[ \t]*#*[ \t]*(\r?\n|$)/, "")
    .trimStart();
}

function base(
  doc: WithSeedVerdict<PromptDocumentSummary>
): Omit<IntentEntry, "state" | "body" | "title"> {
  return {
    kind: doc.kind as SummaryIntentKind,
    name: doc.name,
    description: doc.description,
    updatedAt: doc.updated_at ?? null,
  };
}

/**
 * Sort one kind's documents into reading order: the kind's stated order
 * first, then anything else by title. Deterministic either way — coord's own
 * ordering is alphabetical by slug, which is not an editorial judgement.
 */
export function sortIntentEntries(entries: IntentEntry[]): IntentEntry[] {
  const rank = (e: IntentEntry) => {
    const i = INTENT_DOC_ORDER[e.kind].indexOf(e.name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...entries].sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)
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
    error,
    title: titleOfDocument(doc.name, ""),
  };
}

/** True when an entry has something to show a reader: real text, or a load
 *  failure that must be reported rather than read as "not written". */
export function hasContent(entry: IntentEntry): boolean {
  if (entry.state === "unreadable") return true;
  if (entry.state === "skeleton") return false;
  return entry.body.trim().length > 0;
}
