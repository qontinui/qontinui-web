/**
 * `?kind=&name=` — a link straight to one prompt document (plan
 * `2026-10-06-overview-objectives-view` D2: the Objectives card's "Edit the
 * measure's definition"). The list opens that document's editor once it has
 * loaded; an unknown pair says "no such document" rather than silently
 * leaving the reader on the list; and a list that could not be read says the
 * document could not be looked up — never "no such document".
 */

import type { PromptDocumentKind, PromptDocumentSummary } from "../types";
import { PROMPT_DOCUMENT_KINDS } from "../types";

export interface DeepLink {
  kind: string;
  name: string;
}

export type DeepLinkResolution =
  | { state: "pending" }
  | { state: "found"; doc: PromptDocumentSummary }
  | { state: "missing"; link: DeepLink }
  | { state: "unknown"; link: DeepLink; reason: string };

/** The pair from the URL, or null when the URL names no document. */
export function parseDeepLink(params: {
  get(key: string): string | null;
}): DeepLink | null {
  const kind = params.get("kind")?.trim() ?? "";
  const name = params.get("name")?.trim() ?? "";
  if (!kind && !name) return null;
  return { kind, name };
}

export function resolveDeepLink(
  link: DeepLink,
  list: {
    documents: readonly PromptDocumentSummary[];
    loading: boolean;
    error: string | null;
    degraded: string | null;
  }
): DeepLinkResolution {
  if (!link.kind || !link.name) return { state: "missing", link };
  if (!PROMPT_DOCUMENT_KINDS.includes(link.kind as PromptDocumentKind)) {
    return { state: "missing", link };
  }
  const doc = list.documents.find(
    (d) => d.kind === link.kind && d.name === link.name
  );
  if (doc) return { state: "found", doc };
  if (list.loading) return { state: "pending" };
  if (list.error) return { state: "unknown", link, reason: list.error };
  if (list.degraded) return { state: "unknown", link, reason: list.degraded };
  return { state: "missing", link };
}
