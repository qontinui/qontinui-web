'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Organization } from '@/types/collaboration';
import { organizationService } from '@/services/service-factory';

// ============================================================================
// Context Types
// ============================================================================

interface OrganizationContextValue {
  currentOrganization: Organization | null;
  organizations: Organization[];
  loading: boolean;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  createOrganization: (name: string, description?: string) => Promise<Organization>;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

// ============================================================================
// Provider Props
// ============================================================================

interface OrganizationProviderProps {
  children: ReactNode;
}

// ============================================================================
// Local Storage Key
// ============================================================================

const STORAGE_KEY = 'qontinui_current_organization';

// ============================================================================
// Provider Component
// ============================================================================

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load organizations on mount
   */
  useEffect(() => {
    // Don't block rendering - load organizations in background
    loadOrganizations().catch((err) => {
      console.warn('[Organization] Failed to initialize organizations:', err);
      // Silently fail - user can continue without organizations
    });
  }, []);

  /**
   * Load all organizations and restore the current one from localStorage
   */
  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const orgs = await organizationService.getOrganizations();
      setOrganizations(orgs);

      // Try to restore current organization from localStorage
      const storedOrgId = localStorage.getItem(STORAGE_KEY);
      if (storedOrgId && orgs.length > 0) {
        const storedOrg = orgs.find((org) => org.id === storedOrgId);
        if (storedOrg) {
          setCurrentOrganization(storedOrg);
        } else {
          // Stored org not found, select first org
          setCurrentOrganization(orgs[0]);
          localStorage.setItem(STORAGE_KEY, orgs[0].id);
        }
      } else if (orgs.length > 0 && !currentOrganization) {
        // No stored org, select first one
        setCurrentOrganization(orgs[0]);
        localStorage.setItem(STORAGE_KEY, orgs[0].id);
      }
    } catch (error) {
      console.error('[Organization] Failed to load organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Switch to a different organization
   */
  const switchOrganization = async (orgId: string) => {
    try {
      const org = organizations.find((o) => o.id === orgId);
      if (org) {
        setCurrentOrganization(org);
        localStorage.setItem(STORAGE_KEY, orgId);
      } else {
        // Fetch the organization if not in the list
        const fetchedOrg = await organizationService.getOrganization(orgId);
        setCurrentOrganization(fetchedOrg);
        localStorage.setItem(STORAGE_KEY, orgId);
        // Refresh the list to include the new organization
        await loadOrganizations();
      }
    } catch (error) {
      console.error('[Organization] Failed to switch organization:', error);
      throw error;
    }
  };

  /**
   * Refresh the organization list
   */
  const refreshOrganizations = async () => {
    await loadOrganizations();
  };

  /**
   * Create a new organization
   */
  const createOrganization = async (
    name: string,
    description?: string
  ): Promise<Organization> => {
    try {
      const newOrg = await organizationService.createOrganization(name, description);

      // Refresh organizations list
      await loadOrganizations();

      // Switch to the newly created organization
      await switchOrganization(newOrg.id);

      return newOrg;
    } catch (error) {
      console.error('[Organization] Failed to create organization:', error);
      throw error;
    }
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: OrganizationContextValue = {
    currentOrganization,
    organizations,
    loading,
    switchOrganization,
    refreshOrganizations,
    createOrganization,
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
