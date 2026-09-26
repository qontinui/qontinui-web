"use client";

import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";

/**
 * The project on screen, as every overview page reads it. Reads hold until
 * the project list has resolved (the active-project header comes from the
 * same selection, so an earlier read could name a stale project) and while
 * it has failed (the server would answer for a project the page cannot
 * name); they re-run when the project changes (`projectId` as a reload key).
 */
export function useOverviewProject() {
  const { user } = useAuth();
  const {
    activeTenantId,
    loading: tenantsLoading,
    error: tenantsError,
  } = useTenant();
  return {
    projectId: activeTenantId,
    hold: tenantsLoading || tenantsError !== null,
    tenantsError,
    viewerId: user?.id != null ? String(user.id) : null,
  };
}
