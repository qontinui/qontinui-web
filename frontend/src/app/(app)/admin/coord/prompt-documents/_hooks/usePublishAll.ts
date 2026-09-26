"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  classifyPublishError,
  type PublishRefusal,
} from "./usePromptDocumentPublications";
import type {
  AutoPublishStatusEntry,
  AutoPublishStatusResponse,
  PromptDocumentKind,
  PublishAllArmedResponse,
  PublishAllCandidate,
  PublishAllDryRunResponse,
  PublishAllItem,
  PublishMode,
} from "../types";

const API = "/api/v1/operations";
const PUBLISH_ALL = `${API}/coord/prompt-documents/publish-all`;
const AUTO_PUBLISH_STATUS = `${API}/coord/prompt-documents/auto-publish/status`;

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Why a `publish_mode` PATCH failed, recovered from the thrown `Error`'s
 * message — `"<VERB> <url> failed: <status> - <body text>"`.
 *
 * A string sniff, and named as one, exactly like `classifyPublishError`. It
 * chooses an EXPLANATION and never decides whether something is allowed.
 *
 * | Answer | When | Why it is worth separating |
 * |---|---|---|
 * | `schema_missing` | the body names `42703`, or names the column and says it does not exist | Certain: coord is deployed ahead of the `pdpub_03` migration. |
 * | `server_error` | any other 5xx | Probably the same cause — coord's write path does not degrade on a missing column, so the deploy window is the likeliest 500 on THIS field — but not certain, so the copy says "most likely" rather than asserting it. |
 * | `other` | anything else (4xx, transport) | Not this problem. Falls through to the ordinary refusal handling. |
 *
 * Erring toward `server_error` is the right direction: naming a real coord
 * fault as a pending migration costs one misleading sentence beside coord's own
 * verbatim message, while reporting the deploy window as an unexplained 500
 * sends an operator to debug a system behaving exactly as designed.
 */
export function classifyPublishModeError(
  text: string
): "schema_missing" | "server_error" | "other" {
  if (text.includes("42703")) return "schema_missing";
  if (
    text.includes("publish_mode") &&
    (text.includes("does not exist") || text.includes("column"))
  ) {
    return "schema_missing";
  }
  if (/failed: 5\d\d\b/.test(text)) return "server_error";
  return "other";
}

/**
 * "Publish all changed", and the auto-publisher's pending work.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish` D1 and D4. Two coord
 * doors, loaded together because they answer one question from two sides: what
 * is changed and unpublished right now (the dry run), and what is about to
 * publish itself without anyone clicking (the status read).
 *
 * ## Where the button's N comes from, and why it is not the dry run
 *
 * D1: the button is "visible only when N > 0". N is the size of the candidate
 * set, which is a join of body digests against publication digests inside coord
 * — the document list carries neither side of it, so the count has to be asked
 * for rather than derived here.
 *
 * It is asked for with the STATUS READ, a GET, and the dry run is deferred to
 * the moment the dialog opens. Two reasons, in order:
 *
 * 1. **A page load must not issue a write-shaped request.** The dry run is a
 *    POST — coord serves the preview and the armed run through one door — and
 *    it is gated on `require_coord_tenant_admin`. Firing it on
 *    mount would POST to an admin write door on every visit to this page in
 *    every tenant, and would couple every test of this list to the publish-all
 *    door. The status read is a GET on tenant membership and is needed on mount
 *    anyway, for the badges.
 * 2. **Taking the dry run at dialog-open time makes the version guarantee
 *    tighter, not looser.** The versions the operator confirms are the ones
 *    coord returned seconds earlier, rather than whatever the page happened to
 *    read when it loaded.
 *
 * **The assumption this rests on, stated so it can be falsified:** coord builds
 * both answers from one `publication_candidates` helper (Phase 2 — "shared by
 * publish-all, the status route and the worker"), so the status read names the
 * same documents the dry run would. D4 requires each status entry to report
 * `publish_mode`, which is only a fact worth serving if the set includes modes
 * other than `auto` — i.e. the whole candidate set. If a coord release ever
 * narrowed the status route to `auto` documents only, the button would
 * undercount and could hide while `manual` documents waited. The dialog's own
 * count comes from the dry run and is authoritative, so the failure would be a
 * hidden button rather than a wrong publication.
 *
 * ## The one property this hook exists to preserve
 *
 * **Each item is armed with the `expected_version` the DRY RUN returned**, not
 * with a version re-read from the document list. {@link publishAll} takes the
 * candidates themselves rather than `(kind, name)` pairs precisely so no call
 * site can substitute a fresher number. A document edited between the preview
 * and the click then fails `version_conflict` — loudly, per item, with the
 * others still publishing — instead of publishing a body nobody has seen. That
 * is the guarantee single-document publishing already gives, and the whole
 * reason the armed run takes a list of versions rather than a "publish
 * everything" flag.
 *
 * ## Why a refusal RETIRES the surface instead of being re-offered
 *
 * Both doors are gated on the system tenant, and nothing on the prompt-document
 * wire tells a browser whether the tenant it is looking at carries coord's
 * `is_system` marker — the same wall `usePromptDocumentPublications` documents
 * at length. So the console asks, and coord's own `not_system_tenant` (or this
 * deployment's not-yet-proxied 404) is the answer. It latches for the rest of
 * the page's life and everything this hook drives — the button, the dialog and
 * every badge — disappears.
 *
 * **That latch is silent, and the silence is deliberate.** Every non-system
 * tenant's console mounts this hook and is refused, on every visit. The
 * single-document publish surface can afford a banner because its refusal
 * arrives from a control the operator clicked; this one arrives from a page
 * load nobody asked for, and a toast on it would be an error message on a
 * healthy page in most of the fleet. `unavailable` is exported so a caller that
 * DOES want to say something can.
 */
export function usePublishAll() {
  const [candidates, setCandidates] = useState<PublishAllCandidate[] | null>(
    null
  );
  const [status, setStatus] = useState<AutoPublishStatusEntry[]>([]);
  const [servedCount, setServedCount] = useState(0);
  const statusRequest = useRef(0);
  const [publishingEnabled, setPublishingEnabled] = useState<
    boolean | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [modeSchemaPending, setModeSchemaPending] = useState<string | null>(
    null
  );
  const [unavailable, setUnavailable] = useState<{
    refusal: PublishRefusal;
    detail: string;
  } | null>(null);

  /**
   * Whether a refusal means "this whole surface does not apply here".
   *
   * Only these two. A `version_conflict` or a `kind_not_publishable` is about
   * one document and must never retire the button for the rest.
   */
  const latch = useCallback((detail: string): boolean => {
    const refusal = classifyPublishError(detail);
    if (refusal === "not_system_tenant" || refusal === "not_proxied") {
      setUnavailable({ refusal, detail });
      return true;
    }
    return false;
  }, []);

  /**
   * The preview: every candidate, each with the version it would publish.
   *
   * Called when the dialog OPENS, not on mount — see the module docs. On
   * failure the previous preview is kept rather than blanked, for the reason
   * `usePromptDocuments` keeps its list: an empty candidate set reads as
   * "nothing to publish", which is the one claim a failed read cannot support.
   */
  const loadCandidates = useCallback(async (): Promise<void> => {
    try {
      setPreviewing(true);
      const data = await httpClient.post<PublishAllDryRunResponse>(
        PUBLISH_ALL,
        { dry_run: true }
      );
      setCandidates(data.candidates ?? []);
      setUnavailable(null);
    } catch (err) {
      const detail = message(err, "Failed to preview the changed documents");
      if (!latch(detail)) toast.error(detail);
    } finally {
      setPreviewing(false);
    }
  }, [latch]);

  /** What the auto-publisher would do next, per candidate. */
  const loadStatus = useCallback(async (): Promise<void> => {
    // Reads now overlap (mount, a mode write, a switch write), so only the
    // newest request may land: an older answer arriving last would put back
    // the mode or switch the operator just changed.
    const request = ++statusRequest.current;
    try {
      const data =
        await httpClient.get<AutoPublishStatusResponse>(AUTO_PUBLISH_STATUS);
      if (request !== statusRequest.current) return;
      setStatus(data.candidates ?? []);
      // The D5 switch as coord resolved it. Absent is UNKNOWN (`undefined`),
      // never `true`: a badge must not promise a publication on a guess.
      setPublishingEnabled(
        typeof data.publishing_enabled === "boolean"
          ? data.publishing_enabled
          : undefined
      );
      // Coord's own count for the same set. Preferred over the array's length:
      // if the two disagree, the array is the thing that got truncated.
      setServedCount(
        typeof data.count === "number"
          ? data.count
          : (data.candidates ?? []).length
      );
    } catch (err) {
      if (request !== statusRequest.current) return;
      // Silent by the same rule as the latch above, and one step further: a
      // failed status read costs an ADVISORY badge. Every non-system tenant
      // fails it on every page load, and nothing an operator can do depends on
      // it. The badges simply do not render, which is what "unknown" looks
      // like here.
      latch(message(err, "Failed to read the auto-publish status"));
    }
  }, [latch]);

  const reload = useCallback(async () => {
    setLoading(true);
    await loadStatus();
    setLoading(false);
  }, [loadStatus]);

  useEffect(() => {
    void reload();
    // `reload` is `useCallback`-stable over stable deps, so this runs once per
    // mount rather than on every render.
  }, [reload]);

  /**
   * Arm the run for `selected`, each at the version its DRY RUN entry carried.
   *
   * Takes candidates, not addresses: the version travelling with each item has
   * to be the one the operator was shown, and a `(kind, name)` signature would
   * let a caller look up a fresher one. Resolves to coord's per-item outcomes,
   * or `null` on a refusal already reported.
   */
  const publishAll = useCallback(
    async (
      selected: readonly PublishAllCandidate[],
      releaseNote: string
    ): Promise<PublishAllArmedResponse | null> => {
      const items: PublishAllItem[] = selected.map((candidate) => ({
        kind: candidate.kind,
        name: candidate.name,
        // Verbatim from the dry run. This is the optimistic lock.
        expected_version: candidate.current_version,
      }));
      try {
        setPublishing(true);
        const result = await httpClient.post<PublishAllArmedResponse>(
          PUBLISH_ALL,
          {
            // **Explicit, and never omitted.** On publish-all `dry_run`
            // defaults to TRUE — the opposite of `/publish`, whose default is
            // false. Leaving it out here would take another preview and report
            // it as a publication: a silent no-op that looks exactly like
            // success, on the one button whose whole job is to ship 26
            // documents at once.
            dry_run: false,
            release_note: releaseNote.trim() ? releaseNote.trim() : null,
            items,
          }
        );
        const results = result.results ?? [];
        const published = results.filter(
          (r) => r.outcome === "published"
        ).length;
        const failed = results.length - published;
        if (failed === 0) {
          toast.success(
            `Published ${published} ${published === 1 ? "document" : "documents"} to the fleet.`
          );
        } else {
          // Partial success is the DESIGNED outcome, not an error: each item is
          // published independently, so one conflict neither rolls back nor
          // blocks the rest. Say both halves — a bare error toast would read as
          // "nothing shipped", and something did.
          toast.warning(
            `Published ${published} of ${results.length}; ${failed} did not publish. See the dialog for which and why.`
          );
        }
        return result;
      } catch (err) {
        const detail = message(err, "Failed to publish the changed documents");
        if (!latch(detail)) toast.error(detail);
        return null;
      } finally {
        setPublishing(false);
      }
    },
    [latch]
  );

  /**
   * Set one document's publish mode.
   *
   * **Why this does not go through `usePromptDocuments.updateDocument`**, which
   * is the shared PATCH every other field uses: this field has a failure mode
   * none of the others has, and that hook's `toast.error(… "Failed to save
   * document")` would report it as an ordinary save failure.
   *
   * Coord's READS of `publish_mode` degrade on Postgres `42703` and answer
   * UNDECIDED, so a console can run against a coord deployed ahead of the
   * `pdpub_03` migration. **The WRITE deliberately does not degrade** — you
   * cannot record an authority decision the schema cannot hold, and a write
   * that silently succeeded against a missing column would tell an operator
   * they had set `never` on a document that kept publishing itself. So during
   * the deploy window this PATCH 500s, by design.
   *
   * That 500 is classified rather than swallowed. It is latched into
   * {@link modeSchemaPending} so the list can carry a standing explanation —
   * "the column is not migrated yet", not "coord is broken" — and the control
   * stays on screen, because hiding it would leave no route to the setting once
   * the migration lands. The latch clears on the first write that succeeds.
   */
  const setPublishMode = useCallback(
    async (
      kind: PromptDocumentKind,
      name: string,
      mode: PublishMode
    ): Promise<boolean> => {
      try {
        setSavingMode(true);
        await httpClient.patch(
          `${API}/coord/prompt-documents/${encodeURIComponent(
            kind
          )}/${encodeURIComponent(name)}`,
          {
            publish_mode: mode,
            change_description: `Publish mode set to \`${mode}\` by an operator`,
          }
        );
        setModeSchemaPending(null);
        toast.success(`${kind}/${name} now publishes: ${mode}.`);
        // The badges key on the served mode, so the status read is re-taken:
        // without it a document just set to `manual` or `never` keeps a
        // "Publishes <time>" badge for a publication nothing will make.
        await loadStatus();
        return true;
      } catch (err) {
        const detail = message(err, "Failed to set the publish mode");
        if (classifyPublishModeError(detail) !== "other") {
          setModeSchemaPending(detail);
          toast.error(
            "Coord could not record the publish mode. Its `publish_mode` " +
              "column is most likely not migrated yet — the write refuses " +
              "rather than degrading, because a decision the schema cannot " +
              "hold must not look like it was saved."
          );
        } else if (!latch(detail)) {
          toast.error(detail);
        }
        return false;
      } finally {
        setSavingMode(false);
      }
    },
    [latch, loadStatus]
  );

  return {
    /**
     * Every changed, publishable, not-`never` document — the dry run's answer,
     * verbatim, versions included. `null` until a preview has been taken, which
     * is a different fact from "no candidates" and is why it is not `[]`.
     */
    candidates,
    /** Take (or re-take) the dry run. Call it when the dialog opens. */
    loadCandidates,
    /** True while the dry run is in flight. */
    previewing,
    /** What the auto-publisher would do next, per candidate (D4). */
    status,
    /**
     * Whether the auto-publisher will publish at all — coord's resolved D5
     * switch from the same status read. `undefined` is UNKNOWN.
     */
    publishingEnabled,
    /**
     * N for the "Publish all changed (N)" button — the status read's candidate
     * count, which coord builds from the same `publication_candidates` helper
     * the dry run uses. See the module docs for the assumption and its failure
     * mode.
     */
    changedCount: servedCount,
    loading,
    publishing,
    /** True while a publish-mode PATCH is in flight. */
    savingMode,
    setPublishMode,
    /**
     * Set when a publish-mode write failed in a way that points at the
     * `pdpub_03` migration not being applied yet. Carries coord's verbatim
     * message. Cleared by the next write that succeeds.
     */
    modeSchemaPending,
    /**
     * Set once coord (or this deployment's proxy) has answered that this
     * surface does not apply here at all. `null` means "no answer yet", which
     * is not the same as "available".
     */
    unavailable,
    reload,
    publishAll,
  };
}
