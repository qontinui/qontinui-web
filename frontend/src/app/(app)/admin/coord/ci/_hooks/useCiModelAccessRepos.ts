"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createReadSequence } from "@/components/console";
import { fetchCiHosting } from "@/lib/api/operations/ciStatus";
import { fetchFleetPolicy } from "@/lib/api/operations/tenantPolicy";
import { errorMessage } from "../_lib/errorMessage";
import {
  CI_MODEL_ACCESS_DOMAIN,
  readingFromPolicy,
  unreadReading,
  type ModelAccessReading,
  type ModelAccessRepoReading,
} from "../_lib/ciModelAccessStatus";

/**
 * What `ci_model_access` resolves for each of the tenant's repos.
 *
 * **The repo list** is the hosted-CI read's (`GET /operations/ci-hosting`):
 * coord builds it from `coord.tenant_repos`, which is exactly the set a
 * repo-band fleet-policy write is accepted for (`repo_key_is_tenant_repo`) and
 * in the spelling that write stores. A list coord could not read
 * (`repos_unknown_reason`) is a FAILED read here, never an empty tenant.
 *
 * **Each repo's value** is the generic fleet-policy read with `?repo=`, so a
 * repo-band row for it can win — one read per repo, issued together. One that
 * fails makes THAT repo UNKNOWN with the reason; the others still answer.
 * That is N+1 calls per refresh; a coord-side effective read for this domain
 * (the `GET /coord/ci-hosting/effective` shape) would make it one.
 *
 * **Ordering** is a `createReadSequence`, not a newest-issued guard: every
 * read asks the same question, so an older read that SUCCEEDS after a newer
 * one failed is still the best answer there is — it is shown, labelled stale
 * — rather than discarded.
 *
 * **A repo write** updates only that repo, from the write's own read-back
 * (`applyWriteReadback`), instead of re-reading every repo.
 */
export function useCiModelAccessRepos() {
  const [repos, setRepos] = useState<ModelAccessRepoReading[] | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const seq = useRef(createReadSequence());
  // The rows on screen, for the write path's "is there anything to patch?".
  const reposRef = useRef<ModelAccessRepoReading[] | null>(null);

  const reload = useCallback(async (): Promise<boolean> => {
    const ticket = seq.current.issue();
    setInFlight((n) => n + 1);
    try {
      const list = await fetchCiHosting();
      if (list.repos_unknown_reason) {
        throw new Error(
          `coord could not list this tenant's repos (${list.repos_unknown_reason})`
        );
      }
      // Each repo's read settles to a reading of its own, so one failure is
      // UNKNOWN for that repo alone and never rejects the whole list.
      const next: ModelAccessRepoReading[] = await Promise.all(
        list.repos.map(({ repo }) =>
          fetchFleetPolicy(CI_MODEL_ACCESS_DOMAIN, repo).then(
            (view) => ({ repo, ...readingFromPolicy(view) }),
            (err: unknown) => ({
              repo,
              ...unreadReading(errorMessage(err, "the read failed")),
            })
          )
        )
      );
      const apply = seq.current.settle(ticket, true);
      if (apply) {
        reposRef.current = next;
        setRepos(next);
      }
      const isStale = seq.current.isStale();
      setStale(isStale);
      if (!isStale) setError(null);
      return apply && !isStale;
    } catch (err) {
      seq.current.settle(ticket, false);
      const isStale = seq.current.isStale();
      setStale(isStale);
      // A failure older than a delivered read says nothing new.
      if (isStale || !seq.current.hasDelivered()) {
        setError(errorMessage(err, "the repo list could not be read"));
      }
      return false;
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);

  /**
   * Replace ONE repo's reading with a write's read-back.
   *
   * The read-back takes a ticket of its own and settles it as a delivery that
   * does not COUNT as a read (`counts = false`): a list reload issued before
   * the write — and still in flight — then settles with an older ticket and
   * loses, instead of painting the pre-write value back over the read-back.
   * Not counting it means a write can un-stale the rows but never stale them.
   */
  const applyWriteReadback = useCallback(
    (repo: string, reading: ModelAccessReading) => {
      const prev = reposRef.current;
      if (prev === null) return; // nothing on screen to patch
      const ticket = seq.current.issue();
      if (!seq.current.settle(ticket, true, false)) return;
      const next = prev.map((r) =>
        r.repo === repo ? { repo, ...reading } : r
      );
      reposRef.current = next;
      setRepos(next);
      setStale(seq.current.isStale());
    },
    []
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    repos,
    loading: inFlight > 0,
    error,
    /** Values are on screen, and a newer read finished without replacing them. */
    stale: repos !== null && stale,
    reload,
    applyWriteReadback,
  };
}
