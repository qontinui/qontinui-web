"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCiHosting } from "@/lib/api/operations/ciStatus";
import { fetchFleetPolicy } from "@/lib/api/operations/tenantPolicy";
import {
  CI_MODEL_ACCESS_DOMAIN,
  readingFromPolicy,
  unreadReading,
  type ModelAccessRepoReading,
} from "../_lib/ciModelAccessStatus";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * What `ci_model_access` resolves for each of the tenant's repos.
 *
 * **The repo list** is the hosted-CI read's (`GET /operations/ci-hosting`):
 * coord builds it from `coord.tenant_repos`, which is exactly the set a
 * repo-band fleet-policy write is accepted for (`repo_key_is_tenant_repo`) and
 * in the spelling that write stores. No other web read lists that set.
 *
 * **Each repo's value** is the generic fleet-policy read with `?repo=`, so a
 * repo-band row for it can win — one read per repo, issued together. One that
 * fails makes THAT repo UNKNOWN with the reason; the others still answer.
 *
 * The honesty properties of `useCiHosting`, which this mirrors:
 *
 * 1. **A failed LATEST read keeps the last values, labelled stale** — never
 *    blanked (blank would read as "no repos").
 * 2. **Out-of-order replies cannot paint an older answer over a newer one** —
 *    each read takes a ticket and is applied only when no newer read has
 *    settled.
 */
export function useCiModelAccessRepos() {
  const [repos, setRepos] = useState<ModelAccessRepoReading[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const issued = useRef(0);
  const settled = useRef(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const ticket = (issued.current += 1);
    setLoading(true);
    try {
      const list = await fetchCiHosting();
      // Each repo's read settles to a reading of its own, so one failure is
      // UNKNOWN for that repo alone and never rejects the whole list.
      const next: ModelAccessRepoReading[] = await Promise.all(
        list.repos.map(({ repo }) =>
          fetchFleetPolicy(CI_MODEL_ACCESS_DOMAIN, repo).then(
            (view) => ({ repo, ...readingFromPolicy(view) }),
            (err: unknown) => ({
              repo,
              ...unreadReading(message(err, "the read failed")),
            })
          )
        )
      );
      if (ticket < settled.current) return false;
      settled.current = ticket;
      setRepos(next);
      setError(null);
      return true;
    } catch (err) {
      if (ticket < settled.current) return false;
      settled.current = ticket;
      setError(message(err, "the repo list could not be read"));
      return false;
    } finally {
      if (ticket === issued.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    repos,
    loading,
    error,
    /** Values are on screen, and the newest read failed to replace them. */
    stale: repos !== null && error !== null,
    reload,
  };
}
