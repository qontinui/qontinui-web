/**
 * useProjectPermissions Hook
 *
 * Custom React hook for checking user permissions on a project.
 * Returns permission utilities and current permission level.
 *
 * @example
 * function ProjectEditor({ project }) {
 *   const { canEdit, canComment, canAdmin, permissionLevel } = useProjectPermissions(project);
 *
 *   if (!canEdit) {
 *     return <ReadOnlyView />;
 *   }
 *
 *   return <Editor />;
 * }
 */

import { useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import type { User } from "@/lib/schemas";
import {
  type PermissionLevel,
  type ProjectWithPermissions,
  getPermissionLevel,
  canUserView,
  canUserComment,
  canUserEdit,
  canUserAdmin,
  isProjectOwner,
  hasPermission,
} from "@/lib/permissions";

// ============================================================================
// Hook Return Type
// ============================================================================

export interface ProjectPermissions {
  /**
   * User's current permission level for this project
   */
  permissionLevel: PermissionLevel;

  /**
   * Whether user can view the project
   */
  canView: boolean;

  /**
   * Whether user can comment on the project
   */
  canComment: boolean;

  /**
   * Whether user can edit the project
   */
  canEdit: boolean;

  /**
   * Whether user has admin permissions
   */
  canAdmin: boolean;

  /**
   * Whether user is the project owner
   */
  isOwner: boolean;

  /**
   * Check if user has a specific permission level
   * @param required - The minimum permission level required
   */
  hasPermission: (required: PermissionLevel) => boolean;

  /**
   * The current user (for convenience)
   */
  currentUser: User | null;

  /**
   * Whether auth state is still loading
   */
  isLoading: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook to get permission utilities for a project
 *
 * @param project - Project to check permissions for (can be null/undefined during loading)
 * @returns Permission utilities and current permission level
 *
 * @example
 * // Basic usage
 * const { canEdit, permissionLevel } = useProjectPermissions(project);
 *
 * @example
 * // With loading state
 * const { canEdit, isLoading } = useProjectPermissions(project);
 * if (isLoading) return <Spinner />;
 *
 * @example
 * // Check specific permissions
 * const { hasPermission } = useProjectPermissions(project);
 * if (hasPermission('admin')) {
 *   // Show admin UI
 * }
 */
export function useProjectPermissions(
  project: ProjectWithPermissions | null | undefined
): ProjectPermissions {
  const { user: currentUser, loading: isLoading } = useAuth();

  // Compute all permissions in a single memo to avoid unnecessary recalculation
  const permissions = useMemo(() => {
    // Type assertion to help TypeScript understand the User type
    const user = currentUser as User | null | undefined;
    if (!project) {
      // No project provided - return no permissions
      return {
        permissionLevel: "none" as PermissionLevel,
        canView: false,
        canComment: false,
        canEdit: false,
        canAdmin: false,
        isOwner: false,
        hasPermission: () => false,
        currentUser,
        isLoading,
      } as ProjectPermissions;
    }

    // Get user's permission level
    const permissionLevel = getPermissionLevel(project, user);

    // Pre-compute all permission checks
    const canView = canUserView(project, user);
    const canComment = canUserComment(project, user);
    const canEdit = canUserEdit(project, user);
    const canAdmin = canUserAdmin(project, user);
    const isOwner = isProjectOwner(project, user);

    return {
      permissionLevel,
      canView,
      canComment,
      canEdit,
      canAdmin,
      isOwner,
      hasPermission: (required: PermissionLevel) =>
        hasPermission(required, permissionLevel),
      currentUser,
      isLoading,
    } as ProjectPermissions;
  }, [project, currentUser, isLoading]);

  return permissions;
}

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * Hook to check if user can edit a project
 * Convenience wrapper around useProjectPermissions
 *
 * @example
 * const canEdit = useCanEditProject(project);
 * if (!canEdit) return <ReadOnlyBanner />;
 */
export function useCanEditProject(
  project: ProjectWithPermissions | null | undefined
): boolean {
  const { canEdit } = useProjectPermissions(project);
  return canEdit;
}

/**
 * Hook to check if user can comment on a project
 * Convenience wrapper around useProjectPermissions
 *
 * @example
 * const canComment = useCanCommentProject(project);
 * if (canComment) return <CommentButton />;
 */
export function useCanCommentProject(
  project: ProjectWithPermissions | null | undefined
): boolean {
  const { canComment } = useProjectPermissions(project);
  return canComment;
}

/**
 * Hook to check if user can admin a project
 * Convenience wrapper around useProjectPermissions
 *
 * @example
 * const canAdmin = useCanAdminProject(project);
 * if (canAdmin) return <SettingsButton />;
 */
export function useCanAdminProject(
  project: ProjectWithPermissions | null | undefined
): boolean {
  const { canAdmin } = useProjectPermissions(project);
  return canAdmin;
}

/**
 * Hook to check if user is project owner
 * Convenience wrapper around useProjectPermissions
 *
 * @example
 * const isOwner = useIsProjectOwner(project);
 * if (isOwner) return <DeleteButton />;
 */
export function useIsProjectOwner(
  project: ProjectWithPermissions | null | undefined
): boolean {
  const { isOwner } = useProjectPermissions(project);
  return isOwner;
}
