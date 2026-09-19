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
} from "@/app/(app)/admin/coord/prompt-documents/types";

/** The intent kinds the Summary shows, in page order. */
export const SUMMARY_INTENT_KINDS = [
  "product_intent",
  "initiative",
  "success_metric",
  "audience_profile",
] as const satisfies readonly PromptDocumentKind[];

export type SummaryIntentKind = (typeof SUMMARY_INTENT_KINDS)[number];

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
  state: IntentState;
  /** Readable markdown, frontmatter removed. Empty for a skeleton. */
  body: string;
  updatedAt: string | null;
}

export function toIntentEntry(
  doc: PromptDocument & { unedited_seed?: boolean | null }
): IntentEntry {
  const state = classifyIntent(doc);
  return {
    kind: doc.kind as SummaryIntentKind,
    name: doc.name,
    description: doc.description,
    state,
    body: state === "skeleton" ? "" : stripFrontmatter(doc.body ?? ""),
    updatedAt: doc.updated_at ?? null,
  };
}
