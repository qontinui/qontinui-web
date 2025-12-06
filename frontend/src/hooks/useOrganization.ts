/**
 * useOrganization Hook
 *
 * React hook for organization management including:
 * - Loading and switching organizations
 * - Creating organizations
 * - Managing members
 * - Inviting users
 */

import { useState, useEffect, useCallback } from "react";
import type {
  Organization,
  TeamMember,
  MemberRole,
} from "@/types/collaboration";
import { organizationService } from "@/services/service-factory";

// ============================================================================
// Hook Return Type
// ============================================================================

interface UseOrganizationReturn {
  // State
  organizations: Organization[];
  currentOrg: Organization | null;
  members: TeamMember[];
  loading: boolean;
  error: Error | null;

  // Methods
  switchOrg: (orgId: string) => Promise<void>;
  createOrg: (name: string, description?: string) => Promise<Organization>;
  updateOrg: (
    orgId: string,
    name: string,
    description?: string
  ) => Promise<void>;
  deleteOrg: (orgId: string) => Promise<void>;
  inviteMember: (
    orgId: string,
    email: string,
    role: MemberRole
  ) => Promise<void>;
  getMembers: (orgId: string) => Promise<void>;
  updateMemberRole: (
    orgId: string,
    userId: string,
    role: MemberRole
  ) => Promise<void>;
  removeMember: (orgId: string, userId: string) => Promise<void>;
  leaveOrg: (orgId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useOrganization(): UseOrganizationReturn {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Load all organizations
   */
  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const orgs = await organizationService.getOrganizations();
      setOrganizations(orgs);

      // Set first org as current if none selected
      if (orgs.length > 0 && !currentOrg) {
        setCurrentOrg(orgs[0]);
        // Load members for the first org
        await loadMembers((orgs[0]!).id);
      }
    } catch (err) {
      console.error("[useOrganization] Failed to load organizations:", err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  /**
   * Load members for an organization
   */
  const loadMembers = async (orgId: string) => {
    try {
      const orgMembers = await organizationService.getMembers(orgId);
      setMembers(orgMembers);
    } catch (err) {
      console.error("[useOrganization] Failed to load members:", err);
      throw err;
    }
  };

  /**
   * Initial load
   */
  useEffect(() => {
    loadOrganizations();
  }, []);

  /**
   * Switch to a different organization
   */
  const switchOrg = async (orgId: string) => {
    setLoading(true);
    setError(null);

    try {
      const org = await organizationService.getOrganization(orgId);
      setCurrentOrg(org);
      await loadMembers(orgId);
    } catch (err) {
      console.error("[useOrganization] Failed to switch organization:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Create a new organization
   */
  const createOrg = async (
    name: string,
    description?: string
  ): Promise<Organization> => {
    setLoading(true);
    setError(null);

    try {
      const newOrg = await organizationService.createOrganization(
        name,
        description
      );

      // Add to organizations list
      setOrganizations((prev) => [...prev, newOrg]);

      // Switch to new org
      setCurrentOrg(newOrg);
      setMembers([]);

      return newOrg;
    } catch (err) {
      console.error("[useOrganization] Failed to create organization:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update an organization
   */
  const updateOrg = async (
    orgId: string,
    name: string,
    description?: string
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const updates =
        description !== undefined ? { name, description } : { name };
      const updatedOrg = await organizationService.updateOrganization(
        orgId,
        updates
      );

      // Update in organizations list
      setOrganizations((prev) =>
        prev.map((org) => (org.id === orgId ? updatedOrg : org))
      );

      // Update current org if it's the one being updated
      if (currentOrg && currentOrg.id === orgId) {
        setCurrentOrg(updatedOrg);
      }
    } catch (err) {
      console.error("[useOrganization] Failed to update organization:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Delete an organization
   */
  const deleteOrg = async (orgId: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await organizationService.deleteOrganization(orgId);

      // Remove from organizations list
      setOrganizations((prev) => prev.filter((org) => org.id !== orgId));

      // Clear current org if it's the one being deleted
      if (currentOrg && currentOrg.id === orgId) {
        const remaining = organizations.filter((org) => org.id !== orgId);
        setCurrentOrg(remaining.length > 0 ? remaining[0] : null);
        setMembers([]);
      }
    } catch (err) {
      console.error("[useOrganization] Failed to delete organization:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Invite a member to an organization
   */
  const inviteMember = async (
    orgId: string,
    email: string,
    role: MemberRole
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await organizationService.inviteMember(orgId, email, role);

      // Reload members
      if (currentOrg && currentOrg.id === orgId) {
        await loadMembers(orgId);
      }
    } catch (err) {
      console.error("[useOrganization] Failed to invite member:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get members for an organization
   */
  const getMembers = async (orgId: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await loadMembers(orgId);
    } catch (err) {
      console.error("[useOrganization] Failed to get members:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update a member's role
   */
  const updateMemberRole = async (
    orgId: string,
    userId: string,
    role: MemberRole
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await organizationService.updateMemberRole(orgId, userId, role);

      // Update member in list
      setMembers((prev) =>
        prev.map((member) =>
          member.user_id === userId ? { ...member, role } : member
        )
      );
    } catch (err) {
      console.error("[useOrganization] Failed to update member role:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Remove a member from an organization
   */
  const removeMember = async (orgId: string, userId: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await organizationService.removeMember(orgId, userId);

      // Remove member from list
      setMembers((prev) => prev.filter((member) => member.user_id !== userId));

      // Update member count in current org
      if (currentOrg && currentOrg.id === orgId) {
        setCurrentOrg({
          ...currentOrg,
          member_count: Math.max(0, currentOrg.member_count - 1),
        });
      }
    } catch (err) {
      console.error("[useOrganization] Failed to remove member:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Leave an organization
   */
  const leaveOrg = async (orgId: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      await organizationService.leaveOrganization(orgId);

      // Remove from organizations list
      setOrganizations((prev) => prev.filter((org) => org.id !== orgId));

      // Clear current org if it's the one being left
      if (currentOrg && currentOrg.id === orgId) {
        const remaining = organizations.filter((org) => org.id !== orgId);
        setCurrentOrg(remaining.length > 0 ? remaining[0] : null);
        setMembers([]);
      }
    } catch (err) {
      console.error("[useOrganization] Failed to leave organization:", err);
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Refresh organizations
   */
  const refresh = async (): Promise<void> => {
    await loadOrganizations();
  };

  return {
    organizations,
    currentOrg,
    members,
    loading,
    error,
    switchOrg,
    createOrg,
    updateOrg,
    deleteOrg,
    inviteMember,
    getMembers,
    updateMemberRole,
    removeMember,
    leaveOrg,
    refresh,
  };
}
