/**
 * The presentation scope form's draft — what the operator is editing, the
 * scope it was made against, and the write it becomes (plan
 * `2026-10-23-console-presentation-spaces` D3.3).
 *
 * The form edits the project's STORED half of the scope (`configured`), never
 * the effective lists: the effective confidential terms also carry the
 * signed-in viewer's OTHER projects' names, which the backend adds on every
 * read and never stores. Seeding the form from them would write one admin's
 * memberships into a row every member of the project can read.
 *
 * An edit is BOUND to the scope it was made against ({@link EditBase}: the
 * project and the stored version at the first keystroke). The panel's own
 * re-reads — its minute-by-minute refresh, a Refresh press, another tab
 * switching the project — replace what the panel shows, never what the edit
 * was made against, so a save is a compare-and-set on what the operator
 * actually edited: a version that moved underneath answers 409, and an edit
 * made for one project is never saved into another's row.
 *
 * Pure: the panel (`PresentationScopePanel.tsx`) owns the state.
 */

import { BackendError } from "@/lib/errors/backend-error-message";
import {
  PresentationScopeConflict,
  type PresentationScopeRecord,
  type PresentationScopeWrite,
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

/** What an edit was made against: the project, and its stored version. */
export interface EditBase {
  readonly tenantId: string;
  readonly version: number;
}

/** The operator's edit, bound to the scope it was made against. */
export interface ScopeEdit {
  readonly draft: ScopeDraft;
  readonly base: EditBase;
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

/** The scope `record` is: its project, and its stored version. */
export function baseOf(record: PresentationScopeRecord): EditBase {
  return { tenantId: record.tenant_id, version: record.configured.version };
}

/** Whether `edit` was made for the project `record` belongs to. */
export function editIsFor(
  edit: ScopeEdit,
  record: PresentationScopeRecord
): boolean {
  return edit.base.tenantId === record.tenant_id;
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

type DraftLists = Pick<
  PresentationScopeWrite,
  "first_party_owners" | "confidential_terms"
>;

function listsOf(draft: ScopeDraft): DraftLists {
  return {
    first_party_owners:
      draft.ownersMode === "registered" ? null : parseOwners(draft.ownersText),
    confidential_terms: parseTerms(draft.termsText),
  };
}

/**
 * The write an edit becomes: its lists, against the project AND the stored
 * version it was made from (the backend answers 409 when either has moved).
 * The backend normalises and validates both lists; this only splits the text.
 */
export function writeFromEdit(edit: ScopeEdit): PresentationScopeWrite {
  return {
    ...listsOf(edit.draft),
    expected_version: edit.base.version,
    expected_tenant_id: edit.base.tenantId,
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
  const lists = listsOf(draft);
  const storedOwners = configured.first_party_owners;
  const ownersChanged =
    lists.first_party_owners === null || storedOwners === null
      ? lists.first_party_owners !== storedOwners
      : !sameList(
          distinct(
            lists.first_party_owners.map((o) =>
              o.replace(/^@/, "").toLowerCase()
            )
          ),
          storedOwners
        );
  const terms = distinct(
    lists.confidential_terms.map((t) => t.replace(/\s+/g, " "))
  );
  return ownersChanged || !sameList(terms, configured.confidential_terms);
}

/**
 * What a failed save means for the operator — read from what the failure
 * OBSERVED, never guessed (served ux-priorities
 * `a-status-signal-must-observe-the-state-it-names`):
 *
 * - `conflict` / `tenant-moved` — a 409: the backend compared and refused,
 *   so nothing was written;
 * - `refused` — any other 4xx: the backend read the request and refused it,
 *   so nothing was written (a 403: not an admin of this project);
 * - `unknown` — a 5xx, a timeout or a lost connection: the request may have
 *   been committed before the answer was lost (the backend commits, then
 *   reads coord to render the answer), so the outcome is UNKNOWN. HttpClient
 *   retries a PUT's 5xx itself, so a committed write followed by a 5xx comes
 *   back as a version conflict against the operator's OWN write — which is
 *   why the conflict notice never says who saved.
 */
export type SaveFailure =
  | { readonly kind: "conflict" }
  | { readonly kind: "tenant-moved" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "unknown"; readonly message: string };

const NOT_ADMIN =
  "The save was refused: only an admin of this project may change its presentation scope.";

export function saveFailureOf(err: unknown): SaveFailure {
  if (err instanceof PresentationScopeConflict) {
    return err.conflict === "tenant"
      ? { kind: "tenant-moved" }
      : { kind: "conflict" };
  }
  if (err instanceof BackendError) {
    // A 409 that did not come through the client's reader is still a refused
    // compare-and-set: re-read, and keep the edit bound to its own project.
    if (err.status === 409) return { kind: "conflict" };
    if (err.status === 403) return { kind: "refused", message: NOT_ADMIN };
    if (err.status >= 400 && err.status < 500) {
      return {
        kind: "refused",
        message: `The save was refused: ${err.message}`,
      };
    }
    return {
      kind: "unknown",
      message: `The save's outcome is unknown (${err.message}).`,
    };
  }
  const why =
    err instanceof Error && err.message
      ? err.message
      : "the request did not complete";
  return {
    kind: "unknown",
    message: `The save's outcome is unknown (${why}).`,
  };
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
