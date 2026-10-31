/**
 * redaction — D3.3's free-text rule, as pure functions (plan
 * `2026-10-23-console-presentation-spaces`).
 *
 * > Free text (plan, PR, session, finding titles) renders only when the item's
 * > repo owner is on the tenant's first-party list AND it contains none of the
 * > tenant's confidential terms; otherwise a structured descriptor
 * > (kind · area · status · age).
 *
 * Every arm that cannot PROVE the text is safe withholds it:
 *
 * - the scope is `unknown`, `loading` or `error` → withheld;
 * - the item names no repository, or one whose owner cannot be read (a bare
 *   `name` with no owner, a host this module does not parse) → withheld;
 * - ANY of the item's repositories has an owner off the first-party list →
 *   withheld (an item spanning a client's repository is about that client);
 * - the text, or a repository name, contains a confidential term → withheld.
 *
 * Term matching is deliberately loose, because a miss shows a client's name to
 * a prospective client: case, accents, spacing and punctuation are all
 * ignored, in every script ("Acme Corp" matches "ACME-corp" and "acmecorp").
 * Over-matching costs a descriptor instead of a title, which D3 accepts.
 *
 * The descriptor is built from STRUCTURED fields only, and it is checked too:
 * `area` is tenant-authored and may itself name a client, so it is withheld
 * whenever the scope is not `ready` or it matches a term. `kind` and `status`
 * must come from the item's own fixed vocabulary — never free text — and are
 * still checked against the terms when the scope is known.
 */

import { presentationAge } from "./presentationClock";
import type { PresentationScopeState } from "./presentationScope";

/** A descriptor field that some kinds of item do not have. */
export type RedactionDescriptorField = "area" | "status" | "at";

/** The structured description shown in place of withheld free text. */
export interface RedactionDescriptor {
  /** What the item is, in the reader's words: "Plan", "Pull request", "Session". */
  readonly kind: string;
  /** The item's area (e.g. a work unit's `metadata.area`). Tenant-authored. */
  readonly area?: string | null;
  /** A status word from the item's own vocabulary ("in progress", "merged"). */
  readonly status?: string | null;
  /** When the item last changed (ISO-8601); rendered as an age. */
  readonly at?: string | null;
  /**
   * The fields this KIND of item does not have — a tenant's name has no area,
   * status or age of its own, nor does a line of a document an area. The line
   * leaves them out rather than calling them unknown: "area unknown" says an
   * area exists and was not read, which is false of an item that has none
   * (served policy `ux-priorities`
   * `a-label-names-one-referent-and-a-quantity-names-its-unit`). A field the
   * item has but the page was not served stays "unknown". A field listed here
   * is left out whatever it holds; `kind` is never left out.
   */
  readonly notApplicable?: readonly RedactionDescriptorField[];
}

/** An item's free text and the repositories it belongs to. */
export interface RedactionInput {
  readonly text: string;
  /**
   * The item's repository as `owner/name` (a GitHub URL also parses), or every
   * repository for an item that spans several. Absent or empty → withheld.
   */
  readonly repo: string | readonly string[] | null | undefined;
}

export type RedactionReason =
  | "scope-unknown"
  | "scope-loading"
  | "scope-error"
  | "no-repo"
  | "foreign-owner"
  | "confidential-term";

export type RedactionVerdict =
  | { readonly show: true }
  | { readonly show: false; readonly reason: RedactionReason };

/** Shown for a withheld descriptor field. */
export const WITHHELD = "withheld";

const DESCRIPTOR_SEPARATOR = " · ";

/**
 * The owner segment of a repository reference, lower-cased; `null` when there
 * is none to read. Accepts `owner/name`, `owner/name#123`, an
 * `https://github.com/owner/name` URL and `git@github.com:owner/name.git`.
 * Anything else — a bare name, another host — yields an owner that will not
 * be on a first-party list, or none at all, and so is withheld.
 */
export function repoOwnerOf(repo: string | null | undefined): string | null {
  if (!repo) return null;
  const trimmed = repo
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "");
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const owner = trimmed.slice(0, slash).trim().replace(/^@/, "").toLowerCase();
  return owner || null;
}

/**
 * Text folded for term matching: compatibility-decomposed, accents dropped,
 * lower-cased, and everything but letters and digits (in any script) removed.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Whether `text` contains any of `terms`, under {@link normalizeForMatch}. A
 * term with no letters or digits names nothing and is skipped.
 */
export function containsConfidentialTerm(
  text: string,
  terms: readonly string[]
): boolean {
  const haystack = normalizeForMatch(text);
  if (!haystack) return false;
  return terms.some((term) => {
    const needle = normalizeForMatch(term);
    return needle.length > 0 && haystack.includes(needle);
  });
}

function reposOf(repo: RedactionInput["repo"]): string[] {
  if (repo === null || repo === undefined) return [];
  return (typeof repo === "string" ? [repo] : [...repo]).filter(
    (r) => r.trim().length > 0
  );
}

/** Whether D3.3 lets `input.text` render under `scope`. */
export function redactionVerdict(
  input: RedactionInput,
  scope: PresentationScopeState
): RedactionVerdict {
  if (scope.status === "unknown")
    return { show: false, reason: "scope-unknown" };
  if (scope.status === "loading")
    return { show: false, reason: "scope-loading" };
  if (scope.status === "error") return { show: false, reason: "scope-error" };

  const repos = reposOf(input.repo);
  if (repos.length === 0) return { show: false, reason: "no-repo" };

  const firstParty = new Set(
    scope.scope.firstPartyOwners
      .map((o) => o.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)
  );
  for (const repo of repos) {
    const owner = repoOwnerOf(repo);
    if (owner === null || !firstParty.has(owner)) {
      return {
        show: false,
        reason: owner === null ? "no-repo" : "foreign-owner",
      };
    }
  }

  const terms = scope.scope.confidentialTerms;
  if (
    containsConfidentialTerm(input.text, terms) ||
    repos.some((repo) => containsConfidentialTerm(repo, terms))
  ) {
    return { show: false, reason: "confidential-term" };
  }
  return { show: true };
}

function presentField(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The descriptor line, `kind · area · status · age`. A missing field says it
 * is unknown; a field that may name someone the scope cannot clear says
 * `withheld`; a field the item's kind does not have (`notApplicable`) is left
 * out. The age is `presentationAge`'s: `now` defaults to the clock, and
 * `null` — a server or hydration render — states the instant instead.
 */
export function describeRedacted(
  descriptor: RedactionDescriptor,
  scope: PresentationScopeState,
  options: { now?: number | null } = {}
): string {
  const terms = scope.status === "ready" ? scope.scope.confidentialTerms : null;
  const checked = (value: string) =>
    terms !== null && containsConfidentialTerm(value, terms) ? WITHHELD : value;
  const applies = (field: RedactionDescriptorField) =>
    !(descriptor.notApplicable ?? []).includes(field);

  const kind = presentField(descriptor.kind);
  const area = presentField(descriptor.area);
  const status = presentField(descriptor.status);
  const parts = [
    kind === null ? "item" : checked(kind),
    !applies("area")
      ? null
      : area === null
        ? "area unknown"
        : terms === null
          ? `area ${WITHHELD}`
          : checked(area) === WITHHELD
            ? `area ${WITHHELD}`
            : area,
    !applies("status")
      ? null
      : status === null
        ? "status unknown"
        : checked(status),
    !applies("at")
      ? null
      : presentationAge(
          descriptor.at,
          options.now === undefined ? Date.now() : options.now,
          "age unknown"
        ),
  ];
  return parts
    .filter((part): part is string => part !== null)
    .join(DESCRIPTOR_SEPARATOR);
}
