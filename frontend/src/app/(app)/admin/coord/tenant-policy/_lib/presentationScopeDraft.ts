/**
 * The presentation scope form's draft — what the operator is editing, and the
 * write it becomes (plan `2026-10-23-console-presentation-spaces` D3.3).
 *
 * The form edits the project's STORED half of the scope (`configured`), never
 * the effective lists: the effective confidential terms also carry the
 * signed-in viewer's OTHER projects' names, which the backend adds on every
 * read and never stores. Seeding the form from them would write one admin's
 * memberships into a row every member of the project can read.
 *
 * Pure: the panel (`PresentationScopePanel.tsx`) owns the state.
 */

import type {
  PresentationScopeRecord,
  PresentationScopeWrite,
} from "@/lib/api/presentationScope";

/** Where the first-party owners come from. */
export type OwnersMode =
  /** The owners of the project's registered repositories (stored as `null`). */
  | "registered"
  /** The owners listed in the draft. An empty list withholds every title. */
  | "list";

export interface ScopeDraft {
  readonly ownersMode: OwnersMode;
  /** GitHub owners, separated by commas, spaces or new lines. */
  readonly ownersText: string;
  /** One confidential term per line. */
  readonly termsText: string;
}

type Configured = PresentationScopeRecord["configured"];

/** The draft of what the project has stored. */
export function draftFromConfigured(configured: Configured): ScopeDraft {
  return {
    ownersMode: configured.first_party_owners === null ? "registered" : "list",
    ownersText: (configured.first_party_owners ?? []).join("\n"),
    termsText: configured.confidential_terms.join("\n"),
  };
}

/** The owners a text names: split on commas and whitespace, blanks dropped. */
export function parseOwners(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((owner) => owner.trim())
    .filter(Boolean);
}

/** The terms a text names: one per line, trimmed, blanks dropped. */
export function parseTerms(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * The write a draft becomes, against the stored `version` it was made from
 * (the backend answers 409 when that version has moved). The backend
 * normalises and validates both lists; this only splits the text.
 */
export function writeFromDraft(
  draft: ScopeDraft,
  version: number
): PresentationScopeWrite {
  return {
    first_party_owners:
      draft.ownersMode === "registered" ? null : parseOwners(draft.ownersText),
    confidential_terms: parseTerms(draft.termsText),
    expected_version: version,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Distinct values in first-seen order. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Whether saving `draft` would change what is stored — compared the way the
 * backend stores each list (owners lower-cased without `@`, terms with their
 * whitespace collapsed), so retyping what is stored is not a change.
 */
export function draftChangesStored(
  draft: ScopeDraft,
  configured: Configured
): boolean {
  const write = writeFromDraft(draft, configured.version);
  const storedOwners = configured.first_party_owners;
  const ownersChanged =
    write.first_party_owners === null || storedOwners === null
      ? write.first_party_owners !== storedOwners
      : !sameList(
          distinct(
            write.first_party_owners.map((o) =>
              o.replace(/^@/, "").toLowerCase()
            )
          ),
          storedOwners
        );
  const terms = distinct(
    write.confidential_terms.map((t) => t.replace(/\s+/g, " "))
  );
  return ownersChanged || !sameList(terms, configured.confidential_terms);
}

/** Why the registered-repository owners could not be read, in plain words. */
export function unknownOwnersReason(
  reason: PresentationScopeRecord["first_party_owners_unknown_reason"]
): string {
  switch (reason) {
    case "tenant_scope_mismatch":
      return "coord resolved a different project for this request";
    case "coord_unreachable":
      return "coord could not be reached";
    case "coord_refused":
      return "coord refused the read";
    case "coord_unreadable":
      return "coord's answer could not be read";
    default:
      return "no reason was given";
  }
}
