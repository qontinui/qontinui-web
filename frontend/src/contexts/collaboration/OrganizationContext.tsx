'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Organization } from './types';
import { organizationService } from '@/services/service-factory';

// ============================================================================
// Context Types
// ============================================================================

interface OrganizationContextValue {
  currentOrg: Organization | null;
  organizations: Organization[];
  switchOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface OrganizationProviderProps {
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Load organizations on mount
   */
  useEffect(() => {
    loadOrganizations();
  }, []);

  // ============================================================================
  // Methods
  // ============================================================================

  const loadOrganizations = async () => {
    try {
      const orgs = await organizationService.getOrganizations();
      setOrganizations(orgs);

      // Set first org as current if none selected
      if (orgs.length > 0 && !currentOrg) {
        setCurrentOrg(orgs[0]);
      }
    } catch (error) {
      console.error('[Organization] Failed to load organizations:', error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    try {
      const org = await organizationService.getOrganization(orgId);
      setCurrentOrg(org);
    } catch (error) {
      console.error('[Organization] Failed to switch organization:', error);
      throw error;
    }
  };

  const refreshOrganizations = async () => {
    await loadOrganizations();
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: OrganizationContextValue = {
    currentOrg,
    organizations,
    switchOrganization,
    refreshOrganizations,
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
