"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { httpClient } from "@/services/service-factory";
import type { CoordIdentity } from "@/lib/coord-permissions";

/**
 * useCoordIdentity — the caller's coord role set for Coord Console UI gating.
 *
 * The /admin/coord console is VIEWABLE by every authenticated user (the layout
 * no longer hard-gates). Individual mutation controls gate on the caller's
 * COORD role — NOT on qontinui-web's `is_superuser` — mirroring coord's
 * server-side RBAC (`operator < agent_supervisor < admin`).
 *
 * Source: `GET /api/v1/operations/coord/identity`, which reuses the backend's
 * coord-identity fetch of coord `GET /admin/coord/me`. A caller that coord
 * can't resolve to a linked tenant gets `{ roles: [], isAdmin: false }` — the
 * console stays viewable, role-gated controls hide.
 *
 * Gating is UX only. The API endpoints behind each control are the real
 * security boundary and coord enforces them independently.
 *
 * Cached at module scope so repeated mounts within a session don't re-fetch.
 */

const EMPTY_IDENTITY: CoordIdentity = { roles: [], isAdmin: false };

interface CoordIdentityResponse {
  roles?: string[];
  is_admin?: boolean;
}

// Module-scoped cache: shared across every mount of the hook within a session.
let cachedIdentity: CoordIdentity | null = null;
let inflight: Promise<CoordIdentity> | null = null;

async function fetchCoordIdentity(): Promise<CoordIdentity> {
  if (cachedIdentity) return cachedIdentity;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const body = await httpClient.get<CoordIdentityResponse>(
        "/api/v1/operations/coord/identity"
      );
      cachedIdentity = {
        roles: Array.isArray(body?.roles) ? body.roles : [],
        isAdmin: Boolean(body?.is_admin),
      };
    } catch {
      // Coord unreachable / unauthenticated → no coord roles. Don't cache a
      // transient failure so a later mount can retry.
      return EMPTY_IDENTITY;
    } finally {
      inflight = null;
    }
    return cachedIdentity ?? EMPTY_IDENTITY;
  })();
  return inflight;
}

export interface UseCoordIdentityResult {
  roles: string[];
  isAdmin: boolean;
  loading: boolean;
}

export function useCoordIdentity(): UseCoordIdentityResult {
  const { user, loading: authLoading } = useAuth();
  const [identity, setIdentity] = useState<CoordIdentity | null>(cachedIdentity);
  const [loading, setLoading] = useState(!cachedIdentity);

  useEffect(() => {
    // No authenticated user → nothing to resolve.
    if (authLoading) return;
    if (!user) {
      setIdentity(EMPTY_IDENTITY);
      setLoading(false);
      return;
    }
    if (cachedIdentity) {
      setIdentity(cachedIdentity);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetchCoordIdentity().then((resolved) => {
      if (!active) return;
      setIdentity(resolved);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  return {
    roles: identity?.roles ?? [],
    isAdmin: identity?.isAdmin ?? false,
    loading,
  };
}
