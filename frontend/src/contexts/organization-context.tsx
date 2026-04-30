"use client";

/**
 * OSS-side stub for the organization context.
 *
 * The full implementation (with multi-org list/switch/create) lives in
 * `@qontinui/cloud-control/contexts/organization-context`. OSS-only
 * deployments use this stub: a single default-org is created server-side
 * on signup (per `tmp_cloud_control_carve_out.md` §1 verdict #1) so the
 * client doesn't need org switching. The stub satisfies the
 * `useOrganization()` contract used by the OSS sidebar / skill-sharing
 * code paths and returns empty / no-op values.
 *
 * When the cloud-control bundle is loaded, its `routes/organizations/*`
 * pages drive multi-org UX in the cloud-control deployment via lazy
 * routes registered with `registerCloudExtensions`. The OSS sidebar's
 * `OrganizationSwitcher` slot is also stubbed (returns `null`) so the
 * single-tenant experience is uncluttered.
 */
import React, { createContext, useContext, ReactNode } from "react";
import type { Organization } from "@/types/collaboration";

interface OrganizationContextValue {
  currentOrganization: Organization | null;
  organizations: Organization[];
  loading: boolean;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  createOrganization: (
    name: string,
    description?: string
  ) => Promise<Organization>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(
  undefined
);

const stubValue: OrganizationContextValue = {
  currentOrganization: null,
  organizations: [],
  loading: false,
  switchOrganization: async () => {},
  refreshOrganizations: async () => {},
  createOrganization: async () => {
    throw new Error(
      "createOrganization is only available in the cloud-control deployment"
    );
  },
};

interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  return (
    <OrganizationContext.Provider value={stubValue}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  return ctx ?? stubValue;
}
