/**
 * Project Collaboration Service
 *
 * Handles project sharing and collaboration features including:
 * - Sharing projects with users and organizations
 * - Managing collaborator permissions
 * - Access control checks
 * - Permission-based action authorization
 */

import { HttpClient } from "../http-client";
import { ApiConfig } from "../api-config";
import type {
  Collaborator,
  ProjectShare,
  PermissionLevel,
  ProjectAction,
} from "@/types/collaboration";

// Permission hierarchy for access checks
const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  comment: 2,
  edit: 3,
  admin: 4,
  owner: 5,
};

// Actions and their required permission levels
const ACTION_PERMISSIONS: Record<ProjectAction, PermissionLevel> = {
  view: "view",
  comment: "comment",
  edit: "edit",
  delete: "admin",
  share: "admin",
  manage_permissions: "admin",
  export: "edit",
};

export class ProjectCollaborationService {
  private httpClient: HttpClient;
  private apiUrl: string;
  private projectPermissions: Map<string, PermissionLevel> = new Map();

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  // ============================================================================
  // Project Sharing
  // ============================================================================

  /**
   * Share a project with a specific user
   */
  async shareProject(
    projectId: string,
    userId: string,
    permission: PermissionLevel
  ): Promise<void> {
    const data: ProjectShare = { user_id: userId, permission };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/share`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to share project");
    }

    // Clear cached permissions for this project
    this.projectPermissions.delete(projectId);
  }

  /**
   * Share a project with an entire organization
   */
  async shareWithOrganization(
    projectId: string,
    orgId: string,
    permission: PermissionLevel
  ): Promise<void> {
    const data: ProjectShare = { organization_id: orgId, permission };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/share`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || "Failed to share project with organization"
      );
    }

    // Clear cached permissions for this project
    this.projectPermissions.delete(projectId);
  }

  /**
   * Get all collaborators for a project
   */
  async getCollaborators(projectId: string): Promise<Collaborator[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/collaborators`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch collaborators");
    }

    return response.json();
  }

  /**
   * Update a collaborator's permission level
   */
  async updateCollaboratorPermission(
    projectId: string,
    userId: string,
    permission: PermissionLevel
  ): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/collaborators/${userId}`,
      {
        method: "PUT",
        body: JSON.stringify({ permission }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || "Failed to update collaborator permission"
      );
    }

    // Clear cached permissions for this project
    this.projectPermissions.delete(projectId);
  }

  /**
   * Revoke a collaborator's access to a project
   */
  async revokeAccess(projectId: string, userId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/collaborators/${userId}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to revoke access");
    }

    // Clear cached permissions for this project
    this.projectPermissions.delete(projectId);
  }

  // ============================================================================
  // Permission Checks
  // ============================================================================

  /**
   * Get the current user's access level for a project
   */
  async getProjectAccessLevel(projectId: string): Promise<PermissionLevel> {
    // Check cache first
    const cached = this.projectPermissions.get(projectId);
    if (cached) {
      return cached;
    }

    // Fetch from API
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/permissions`
    );

    if (!response.ok) {
      // If we can't fetch permissions, assume no access
      return "none";
    }

    const data = await response.json();
    const permission = data.permission as PermissionLevel;

    // Cache the permission
    this.projectPermissions.set(projectId, permission);

    return permission;
  }

  /**
   * Check if the current user can perform a specific action on a project
   */
  async canPerformAction(
    projectId: string,
    action: ProjectAction
  ): Promise<boolean> {
    const userPermission = await this.getProjectAccessLevel(projectId);
    const requiredPermission = ACTION_PERMISSIONS[action];

    return this.hasPermission(userPermission, requiredPermission);
  }

  /**
   * Synchronously check if a user has sufficient permission
   * (requires permission level to be already cached)
   */
  hasPermissionSync(projectId: string, action: ProjectAction): boolean {
    const userPermission = this.projectPermissions.get(projectId);
    if (!userPermission) {
      // If not cached, assume no permission for safety
      return false;
    }

    const requiredPermission = ACTION_PERMISSIONS[action];
    return this.hasPermission(userPermission, requiredPermission);
  }

  /**
   * Compare two permission levels
   */
  private hasPermission(
    userPermission: PermissionLevel,
    requiredPermission: PermissionLevel
  ): boolean {
    const userLevel = PERMISSION_HIERARCHY[userPermission];
    const requiredLevel = PERMISSION_HIERARCHY[requiredPermission];
    return userLevel >= requiredLevel;
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Clear cached permissions for a project
   */
  clearProjectPermissions(projectId: string): void {
    this.projectPermissions.delete(projectId);
  }

  /**
   * Clear all cached permissions
   */
  clearAllPermissions(): void {
    this.projectPermissions.clear();
  }

  /**
   * Prefetch permissions for multiple projects
   */
  async prefetchPermissions(projectIds: string[]): Promise<void> {
    const uncachedIds = projectIds.filter(
      (id) => !this.projectPermissions.has(id)
    );

    if (uncachedIds.length === 0) {
      return;
    }

    // Fetch permissions in parallel
    await Promise.all(uncachedIds.map((id) => this.getProjectAccessLevel(id)));
  }
}
