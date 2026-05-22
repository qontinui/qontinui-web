"use client";

/**
 * Tenant Context — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Resolves the operator's tenant membership from the web backend
 * (`/api/v1/operations/tenants`) and exposes the active tenant + a
 * setter that persists per-browser in localStorage.
 *
 * Hybrid switcher rules per plan §D12:
 *
 * - Operators in exactly 1 tenant: no switcher renders, no UX choice.
 *   `isMultiTenant` is false and `tenants` carries that single row.
 * - Operators in >1 tenant: switcher renders in the dashboard header
 *   (see `TenantSwitcher.tsx`). First load triggers a one-time
 *   selection persisted as `qontinui.active_tenant_id`.
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
}

interface TenantContextValue {
  tenants: Tenant[];
  activeTenantId: string | null;
  /** True when the operator belongs to >1 tenant. Drives switcher visibility. */
  isMultiTenant: boolean;
  /** True until the first /tenants fetch completes. */
  loading: boolean;
  /** Non-null when the fetch failed; the UI degrades gracefully. */
  error: string | null;
  /** Switch the active tenant id (persisted in localStorage). */
  setActiveTenantId: (id: string) => void;
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

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const data: TenantListResponse = await listTenants(ctrl.signal);
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
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "failed to load tenants"
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

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
    }),
    [tenants, activeTenantId, loading, error, setActiveTenantId]
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
