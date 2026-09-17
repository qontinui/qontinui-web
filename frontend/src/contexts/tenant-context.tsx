"use client";

/**
 * Tenant Context — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Resolves the operator's tenant membership from the web backend
 * (`/api/v1/operations/tenants`) and exposes the active tenant + a
 * setter that persists per-browser in localStorage.
 *
 * Hybrid switcher rules per plan §D12, as they still stand for the
 * SESSIONS-page switcher (`TenantSwitcher.tsx`) and its tenant-breadth tab:
 *
 * - Operators in exactly 1 tenant: no switcher renders, no UX choice.
 *   `isMultiTenant` is false and `tenants` carries that single row.
 * - Operators in >1 tenant: switcher renders in the dashboard header.
 *   First load triggers a one-time selection persisted as
 *   `qontinui.active_tenant_id`.
 *
 * The SIDEBAR project selector (`navigation/sidebar/_components/ProjectSelector.tsx`,
 * formerly the coord console's `CoordTenantSwitcher`) no longer follows
 * that rule: it renders unconditionally, because it also carries the
 * "+ New" project-create action, and the single-project operator is exactly
 * the one who needs it (plan
 * `2026-08-25-self-service-tenant-project-creation`, Phase 3).
 *
 * Sessions are tenant-pinned at start (server-side, `coord.sessions.tenant_id`)
 * and switching the active tenant in the UI does NOT migrate any
 * running session.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listTenants } from "@/components/sessions/api";
import type { TenantListResponse } from "@/components/sessions/types";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  /** The caller's roles in THIS tenant. Absent on a web backend that predates
   *  plan `2026-09-17-tenant-rename` Phase C — treat absent as unknown. */
  roles?: string[];
}

interface TenantContextValue {
  tenants: Tenant[];
  activeTenantId: string | null;
  /** True when the operator belongs to >1 tenant. Drives the SESSIONS-page
   *  switcher + tenant-breadth tab; the coord-console switcher renders
   *  regardless (it also hosts project creation). */
  isMultiTenant: boolean;
  /** True until the first /tenants fetch completes. */
  loading: boolean;
  /** Non-null when the fetch failed; the UI degrades gracefully. */
  error: string | null;
  /** Switch the active tenant id (persisted in localStorage). */
  setActiveTenantId: (id: string) => void;
  /**
   * Re-fetch `/tenants` in place. The list is otherwise fetched once on mount,
   * so a write that changes a tenant's name or slug (the rename dialog) calls
   * this instead of reloading the page. `loading` is true while it runs.
   *
   * Resolves `true` when the list was re-read and `false` when the re-read
   * failed. A failed REFRESH never sets `error` and never clears `tenants`:
   * the previous list is still a real answer, and a global error after a
   * write that succeeded would tell every consumer the tenants are unknown.
   */
  refresh: () => Promise<boolean>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

const STORAGE_KEY = "qontinui.active_tenant_id";

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return localStorage.getItem(STORAGE_KEY);
    }
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch the list. `isRefresh` distinguishes a re-read of a list we already
   * hold from the first load: only the first load's failure is a global
   * `error` (there is no list at all); a refresh failure keeps the last good
   * list and is reported to the caller as `false`.
   */
  const load = useCallback(
    async (signal?: AbortSignal, isRefresh = false): Promise<boolean> => {
      if (isRefresh) setLoading(true);
      try {
        const data: TenantListResponse = await listTenants(signal);
        setTenants(data.tenants);

        // Reconcile localStorage selection against the server's
        // membership view. If the persisted id is not in the
        // tenant list (e.g. operator was removed from the tenant),
        // fall back to the server-side active_tenant_id.
        setActiveTenantIdState((prev) => {
          if (prev && data.tenants.some((t) => t.id === prev)) {
            return prev;
          }
          // No prior selection or stale selection: use the server's
          // hint. This is the "one-time forced selection on first
          // multi-tenant launch" per plan §D12 — for now the
          // server only knows one tenant per operator, so this is
          // a no-op write.
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem(STORAGE_KEY, data.active_tenant_id);
            } catch {
              // ignore quota / private-mode errors
            }
          }
          return data.active_tenant_id;
        });
        setError(null);
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return false;
        if (!isRefresh) {
          setError(
            err instanceof Error ? err.message : "failed to load tenants"
          );
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const refresh = useCallback(() => load(undefined, true), [load]);

  const setActiveTenantId = useCallback((id: string) => {
    setActiveTenantIdState(id);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore
      }
    }
  }, []);

  const value = useMemo<TenantContextValue>(
    () => ({
      tenants,
      activeTenantId,
      isMultiTenant: tenants.length > 1,
      loading,
      error,
      setActiveTenantId,
      refresh,
    }),
    [tenants, activeTenantId, loading, error, setActiveTenantId, refresh]
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used inside <TenantProvider>");
  }
  return ctx;
}
