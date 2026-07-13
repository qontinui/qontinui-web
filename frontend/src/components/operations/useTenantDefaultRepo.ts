"use client";

import { useEffect, useState } from "react";
import { listRegisteredRepos } from "@/components/sessions/api";

export interface UseTenantDefaultRepoResult {
  /**
   * The active tenant's primary (first registered) repo, or `null` when the
   * tenant has no registered repos yet OR the list is still loading. Callers
   * MUST treat `null` as "no default" — never fall back to a hardcoded
   * operator repo.
   */
  defaultRepo: string | null;
  /** True until the first `/operations/repos` fetch settles. */
  loading: boolean;
}

/**
 * Resolve a sensible default repo for the ACTIVE tenant — the first repo in
 * `GET /api/v1/operations/repos` (the tenant's registered `coord.tenant_repos`
 * set, tenant-scoped server-side via the operator bearer + the
 * `X-Qontinui-Active-Tenant` header the shared `httpClient` attaches).
 *
 * Used to seed the repo inputs on the coord-console tiles instead of the
 * operator's own `qontinui/qontinui-*` repos. Returns `null` (not a hardcoded
 * fallback) when the tenant has no registered repos, so callers render an
 * empty "select a repo" state rather than firing a fetch against a repo the
 * tenant doesn't own.
 *
 * Backed by the module-level 30s cache in `listRegisteredRepos`, so multiple
 * consumers on the same page share one in-flight request.
 */
export function useTenantDefaultRepo(): UseTenantDefaultRepoResult {
  const [defaultRepo, setDefaultRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const repos = await listRegisteredRepos(ctrl.signal);
        if (cancelled) return;
        setDefaultRepo(repos[0]?.repo ?? null);
      } catch {
        // Degrade to "no default" — the caller shows an empty/select state.
        if (cancelled) return;
        setDefaultRepo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  return { defaultRepo, loading };
}
