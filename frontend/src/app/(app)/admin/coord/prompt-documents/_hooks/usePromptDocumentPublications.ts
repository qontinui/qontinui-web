"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  ListPublicationsResponse,
  Publication,
  PublicationSummary,
  PromptDocumentKind,
  PublishResponse,
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
  };
}
