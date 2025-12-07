/**
 * useProjectSharing Hook
 *
 * Manages project sharing state and provides methods for:
 * - Loading collaborators
 * - Loading organizations
 * - Adding users/organizations
 * - Changing permissions
 * - Revoking access
 * - Generating share links
 */

import { useState, useEffect, useCallback } from "react";
import {
  projectCollaborationService,
  organizationService,
} from "@/services/service-factory";
import type {
  Collaborator,
  Organization,
  PermissionLevel,
} from "@/types/collaboration";

// Use services from the service factory (properly wired with TokenManager)
const collaborationService = projectCollaborationService;

interface UseProjectSharingOptions {
  projectId: string | null;
  enabled?: boolean;
}

export function useProjectSharing({
  projectId,
  enabled = true,
}: UseProjectSharingOptions) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Load collaborators for the project
   */
  const loadCollaborators = useCallback(async () => {
    if (!projectId || !enabled) return;

    try {
      const data = await collaborationService.getCollaborators(projectId);
      setCollaborators(data);
    } catch (err) {
      console.error("Failed to load collaborators:", err);
      setError(err as Error);
    }
  }, [projectId, enabled]);

  /**
   * Load organizations for the current user
   */
  const loadOrganizations = useCallback(async () => {
    if (!enabled) return;

    try {
      const data = await organizationService.getOrganizations();
      setOrganizations(data);
    } catch (err) {
      console.error("Failed to load organizations:", err);
      // Don't set error for organizations, as user might not have any
      setOrganizations([]);
    }
  }, [enabled]);

  /**
   * Initial load of data
   */
  useEffect(() => {
    if (projectId && enabled) {
      setLoading(true);
      Promise.all([loadCollaborators(), loadOrganizations()]).finally(() =>
        setLoading(false)
      );
    }
  }, [projectId, enabled, loadCollaborators, loadOrganizations]);

  /**
   * Add a user to the project
   */
  const addUser = useCallback(
    async (email: string, permission: PermissionLevel, _expiresAt?: string) => {
      if (!projectId) {
        throw new Error("No project ID provided");
      }

      // For now, we need to look up the user by email
      // In a real implementation, you'd have an API endpoint to share by email
      // This is a simplified version that assumes we have the user_id
      // You may need to add a new endpoint like POST /api/v1/projects/{id}/share/by-email

      // Placeholder: In production, replace with actual API call
      await collaborationService.shareProject(projectId, email, permission);

      // Reload collaborators
      await loadCollaborators();
    },
    [projectId, loadCollaborators]
  );

  /**
   * Add an organization to the project
   */
  const addOrganization = useCallback(
    async (orgId: string, permission: PermissionLevel, _expiresAt?: string) => {
      if (!projectId) {
        throw new Error("No project ID provided");
      }

      await collaborationService.shareWithOrganization(
        projectId,
        orgId,
        permission
      );

      // Reload collaborators
      await loadCollaborators();
    },
    [projectId, loadCollaborators]
  );

  /**
   * Change a collaborator's permission level
   */
  const changePermission = useCallback(
    async (collaboratorId: string, permission: PermissionLevel) => {
      if (!projectId) {
        throw new Error("No project ID provided");
      }

      await collaborationService.updateCollaboratorPermission(
        projectId,
        collaboratorId,
        permission
      );

      // Update local state optimistically
      setCollaborators((prev) =>
        prev.map((c) => (c.id === collaboratorId ? { ...c, permission } : c))
      );
    },
    [projectId]
  );

  /**
   * Revoke a collaborator's access
   */
  const revokeAccess = useCallback(
    async (collaboratorId: string) => {
      if (!projectId) {
        throw new Error("No project ID provided");
      }

      await collaborationService.revokeAccess(projectId, collaboratorId);

      // Update local state optimistically
      setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
    },
    [projectId]
  );

  /**
   * Generate a shareable link
   */
  const generateShareLink = useCallback(async (): Promise<string> => {
    if (!projectId) {
      throw new Error("No project ID provided");
    }

    // This would be implemented on the backend
    // For now, return a placeholder link
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}/shared/project/${projectId}?token=PLACEHOLDER_TOKEN`;
  }, [projectId]);

  /**
   * Get the current user's permission level for this project
   */
  const getMyPermission = useCallback(async (): Promise<PermissionLevel> => {
    if (!projectId) {
      return "none";
    }

    try {
      return await collaborationService.getProjectAccessLevel(projectId);
    } catch (err) {
      console.error("Failed to get permission level:", err);
      return "none";
    }
  }, [projectId]);

  return {
    collaborators,
    organizations,
    loading,
    error,
    addUser,
    addOrganization,
    changePermission,
    revokeAccess,
    generateShareLink,
    getMyPermission,
    reload: loadCollaborators,
  };
}
