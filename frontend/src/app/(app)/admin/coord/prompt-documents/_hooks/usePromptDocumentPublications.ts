"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  ClauseConflictChoice,
  ClauseMergeApplyResponse,
  ClauseMergePreview,
  ListPublicationsResponse,
  Publication,
  PublicationSummary,
  PromptDocumentKind,
  PublishResponse,
  UpstreamDecisionResponse,
} from "../types";

const API = "/api/v1/operations";

/**
 * `/coord/prompt-document-publications/:kind/:name/:version`, each segment
 * encoded.
 */
function publicationPath(
  kind: PromptDocumentKind,
  name: string,
  version: number
): string {
  return `${API}/coord/prompt-document-publications/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/${version}`;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** `/coord/prompt-documents/:kind/:name/<tail>`, each segment encoded. */
function documentPath(
  kind: PromptDocumentKind,
  name: string,
  tail: string
): string {
  return `${API}/coord/prompt-documents/${encodeURIComponent(
    kind
  )}/${encodeURIComponent(name)}/${tail}`;
}

/**
 * The typed refusals coord's publish route can return, recovered from the only
 * signal `httpClient` gives a caller: the thrown `Error`'s message, which is
 * `"<VERB> <url> failed: <status> - <body text>"`.
 *
 * A string sniff, and named as one. It is used to CHOOSE AN EXPLANATION, never
 * to decide whether something is allowed — coord has already decided that, and
 * a sniff that misses simply falls through to `"unknown"`, which renders
 * coord's own message verbatim. The failure mode of getting this wrong is a
 * less specific sentence, not a wrong permission.
 */
export type PublishRefusal =
  | "not_system_tenant"
  | "kind_not_publishable"
  | "version_conflict"
  | "document_not_found"
  | "not_proxied"
  | "unknown";

export function classifyPublishError(text: string): PublishRefusal {
  if (text.includes("not_system_tenant")) return "not_system_tenant";
  if (text.includes("kind_not_publishable")) return "kind_not_publishable";
  if (text.includes("version_conflict")) return "version_conflict";
  if (text.includes("document_not_found")) return "document_not_found";
  // The web backend proxies coord route by route; a 404 that names no coord
  // error code is this deployment's proxy not carrying the route yet, which is
  // a different fact from coord refusing and must not be reported as one.
  if (/failed: 404\b/.test(text)) return "not_proxied";
  return "unknown";
}

/**
 * The typed refusals the three modified-tenant decisions can return (plan
 * `2026-09-04-cross-tenant-policy-publishing` D4 / Phase 7), recovered the same
 * way as [`classifyPublishError`] and with the same caveat: this CHOOSES AN
 * EXPLANATION, it never decides whether something is allowed.
 *
 * Every refusal is toasted in coord's own words. `document_moved` is
 * additionally ACTED on by the caller: the decision was made against a
 * `current_version` that is no longer current, and retrying with the same
 * number would 409 forever — so the list re-reads the document, which puts the
 * live version in front of the operator. The rest need nothing further.
 */
export type UpstreamDecisionRefusal =
  | "document_moved"
  | "already_current"
  | "already_reviewed"
  | "unresolved_conflicts"
  | "whole_body_fallback"
  | "nothing_to_merge"
  | "schema_migration_pending"
  | "not_proxied"
  | "unknown";

export function classifyUpstreamDecisionError(
  text: string
): UpstreamDecisionRefusal {
  for (const code of [
    "document_moved",
    "already_current",
    "already_reviewed",
    "unresolved_conflicts",
    "whole_body_fallback",
    "nothing_to_merge",
    "schema_migration_pending",
  ] as const) {
    if (text.includes(code)) return code;
  }
  if (/failed: 404\b/.test(text)) return "not_proxied";
  return "unknown";
}

/**
 * What one decision call came back with. A refusal carries its classification
 * so the caller can act on the one that has a remedy (`document_moved` →
 * re-read) without re-parsing coord's sentence itself.
 */
export type UpstreamDecisionOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: UpstreamDecisionRefusal; detail: string };

/**
 * Coord's cross-tenant publication channel, from the operator console.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing`, D1/D2. Three reads and one
 * write, all through the coord proxy under `/api/v1/operations`, the same door
 * every sibling `/admin/coord` surface uses.
 *
 * ## Why the console cannot pre-gate the Publish control on "am I the system
 * tenant?"
 *
 * It has no way to ask. Publishing is gated on `coord.tenants.is_system`
 * (`resolve_system_tenant` — the durable marker, never the slug), and nothing
 * on the prompt-document surface tells a browser whether the tenant it is
 * looking at carries that marker: neither the list envelope nor the get-one
 * envelope serves it, and inventing a second signal for it would be a worse
 * answer than asking the authority.
 *
 * So the control is offered for every publishable kind, and coord's own
 * `not_system_tenant` refusal is the answer. [`publishUnavailable`] latches
 * that refusal for the rest of the page's life so the operator meets it once
 * rather than on every document — a latch, deliberately, and not a cache: it is
 * only ever set by an answer from coord, and it is reset by a reload of the
 * page, which is exactly the granularity at which a tenant can change.
 *
 * The alternative — hiding the control until some flag says otherwise — fails
 * in the direction that cannot be recovered from: an operator in the system
 * tenant would see no way to publish and no reason why.
 */
export function usePromptDocumentPublications() {
  const [publishing, setPublishing] = useState(false);
  const [publishUnavailable, setPublishUnavailable] = useState<{
    refusal: PublishRefusal;
    detail: string;
  } | null>(null);

  /**
   * Every publication for one `(kind, name)`, newest first.
   *
   * Bodies are NOT included — coord's list shape is deliberately body-less, the
   * same progressive disclosure the document list uses. Fetch the one you want
   * to read with {@link fetchPublication}.
   */
  const fetchPublications = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string
    ): Promise<PublicationSummary[] | null> => {
      try {
        const data = await httpClient.get<ListPublicationsResponse>(
          `${API}/coord/prompt-document-publications?kind=${encodeURIComponent(
            kind
          )}&name=${encodeURIComponent(name)}`
        );
        return (data.publications ?? [])
          .slice()
          .sort((a, b) => b.publication_version - a.publication_version);
      } catch (err) {
        toast.error(message(err, "Failed to load publications"));
        return null;
      }
    },
    []
  );

  /** One publication WITH its body — the "theirs" side of the three-way view. */
  const fetchPublication = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      version: number
    ): Promise<Publication | null> => {
      try {
        return await httpClient.get<Publication>(
          publicationPath(kind, name, version)
        );
      } catch (err) {
        toast.error(message(err, `Failed to load publication v${version}`));
        return null;
      }
    },
    []
  );

  /**
   * Promote this tenant's current body for `(kind, name)` into the next
   * publication.
   *
   * `expectedVersion` is the `current_version` the operator was looking at:
   * coord 409s rather than publishing a body nobody has seen. Resolves to the
   * publish response (publication + advisory lint) on success, `null` on any
   * refusal — the refusal itself lands in [`publishUnavailable`] when it is one
   * that makes the whole control pointless, and in a toast otherwise.
   */
  const publish = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      expectedVersion: number,
      releaseNote: string
    ): Promise<PublishResponse | null> => {
      try {
        setPublishing(true);
        const result = await httpClient.post<PublishResponse>(
          `${API}/coord/prompt-documents/${encodeURIComponent(
            kind
          )}/${encodeURIComponent(name)}/publish`,
          {
            release_note: releaseNote.trim() ? releaseNote.trim() : null,
            expected_version: expectedVersion,
          }
        );
        toast.success(
          `Published ${kind}/${name} as publication v${result.publication.publication_version}`
        );
        return result;
      } catch (err) {
        const detail = message(err, "Failed to publish");
        const refusal = classifyPublishError(detail);
        // Two refusals are about this DEPLOYMENT or this TENANT rather than
        // about the document in hand, so they retire the control instead of
        // being re-offered document by document.
        if (refusal === "not_system_tenant" || refusal === "not_proxied") {
          setPublishUnavailable({ refusal, detail });
        } else {
          toast.error(detail);
        }
        return null;
      } finally {
        setPublishing(false);
      }
    },
    []
  );

  // ---- the modified-tenant decisions (D4, Phase 7) ----------------------
  //
  // Three writes and one read, all against the SAME document address the
  // dialog already holds. Each write carries `expected_version` — the
  // `current_version` the operator was looking at — so a body that moved
  // underneath the decision is a `document_moved` refusal rather than a
  // silent overwrite. On a refusal the toast carries coord's own sentence and
  // the outcome carries its classification, so the caller can re-read on
  // `document_moved`.

  const [deciding, setDeciding] = useState(false);

  /** The shared write shape: post, toast, classify. */
  const decide = async <T>(
    url: string,
    body: unknown,
    onSuccess: (value: T) => string,
    fallback: string
  ): Promise<UpstreamDecisionOutcome<T>> => {
    try {
      setDeciding(true);
      const value = await httpClient.post<T>(url, body);
      toast.success(onSuccess(value));
      return { ok: true, value };
    } catch (err) {
      const detail = message(err, fallback);
      toast.error(detail);
      return {
        ok: false,
        refusal: classifyUpstreamDecisionError(detail),
        detail,
      };
    } finally {
      setDeciding(false);
    }
  };

  /** `Adopt upstream`: replace the body with the publication and advance the tracked version. */
  const adoptUpstream = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      publicationVersion: number,
      expectedVersion: number
    ): Promise<UpstreamDecisionOutcome<UpstreamDecisionResponse>> =>
      decide<UpstreamDecisionResponse>(
        documentPath(kind, name, "upstream-adopt"),
        {
          publication_version: publicationVersion,
          expected_version: expectedVersion,
        },
        (r) =>
          `Adopted publication v${r.publication_version} as ${kind}/${name} v${r.to_version}`,
        "Failed to adopt the publication"
      ),
    []
  );

  /**
   * `Keep mine`: record "reviewed publication N, declined" — the tracked
   * version advances, the body does not. This is what clears the badge.
   */
  const keepMine = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      publicationVersion: number,
      expectedVersion: number
    ): Promise<UpstreamDecisionOutcome<UpstreamDecisionResponse>> =>
      decide<UpstreamDecisionResponse>(
        documentPath(kind, name, "upstream-keep"),
        {
          publication_version: publicationVersion,
          expected_version: expectedVersion,
        },
        (r) =>
          `Kept your ${kind}/${name}; publication v${r.publication_version} recorded as reviewed`,
        "Failed to record the decision"
      ),
    []
  );

  /**
   * The clause-grained merge PREVIEW for a `policy` document. Read-only —
   * coord decides nothing and writes nothing here. `null` on any failure,
   * with the reason toasted: a preview that could not be read is UNKNOWN,
   * not "nothing to merge".
   */
  const fetchMergePreview = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      publicationVersion: number
    ): Promise<ClauseMergePreview | null> => {
      try {
        return await httpClient.get<ClauseMergePreview>(
          `${documentPath(kind, name, "upstream-merge")}?publication_version=${publicationVersion}`
        );
      } catch (err) {
        toast.error(message(err, "Failed to load the clause merge preview"));
        return null;
      }
    },
    []
  );

  /**
   * `Merge clauses`: land a reviewed clause-grained merge. `resolutions` is
   * one choice per CONFLICTED clause; coord refuses (`unresolved_conflicts`,
   * naming them) rather than defaulting any that are missing, and the panel
   * does not offer the button until every one is chosen — so that refusal is
   * a belt-and-braces check, not the normal path.
   */
  const applyMerge = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      publicationVersion: number,
      expectedVersion: number,
      resolutions: Record<string, ClauseConflictChoice>
    ): Promise<UpstreamDecisionOutcome<ClauseMergeApplyResponse>> =>
      decide<ClauseMergeApplyResponse>(
        documentPath(kind, name, "upstream-merge"),
        {
          publication_version: publicationVersion,
          expected_version: expectedVersion,
          resolutions,
        },
        (r) =>
          `Merged publication v${r.publication_version} into ${kind}/${name} clause by clause (v${r.to_version}, ${r.clauses} clauses)`,
        "Failed to merge the publication"
      ),
    []
  );

  return {
    publishing,
    /**
     * Set once coord (or this deployment's proxy) has answered that publishing
     * is not available here at all. `null` means "no answer yet", which is not
     * the same as "available" — it is why the control is offered rather than
     * asserted.
     */
    publishUnavailable,
    fetchPublications,
    fetchPublication,
    publish,
    /** True while any of the three decisions is in flight. */
    deciding,
    adoptUpstream,
    keepMine,
    fetchMergePreview,
    applyMerge,
  };
}
