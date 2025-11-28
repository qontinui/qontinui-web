/**
 * Permission Utilities
 *
 * Frontend utilities for permission enforcement in the UI.
 * Matches the backend permission model defined in backend/app/models/organization.py
 *
 * Permission hierarchy: view < comment < edit < admin < owner
 */

import type { User } from "@/lib/schemas";

// ============================================================================
// Permission Types
// ============================================================================

/**
 * Permission levels matching backend PermissionLevel enum
 * Backend: class PermissionLevel(str, Enum): VIEW, COMMENT, EDIT, ADMIN
 */
export type PermissionLevel =
  | "none"
  | "view"
  | "comment"
  | "edit"
  | "admin"
  | "owner";

/**
 * Project with permission information
 */
export interface ProjectWithPermissions {
  id: string;
  name: string;
  owner_id: string;
  permission_level?: PermissionLevel;
  [key: string]: any;
}

// ============================================================================
// Permission Hierarchy
// ============================================================================

/**
 * Permission level ordering (higher number = more permissions)
 */
const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  comment: 2,
  edit: 3,
  admin: 4,
  owner: 5,
};

// ============================================================================
// Permission Checking Functions
// ============================================================================

/**
 * Check if a user's permission level meets or exceeds the required level
 *
 * @param requiredLevel - The minimum permission level required
 * @param userLevel - The user's current permission level
 * @returns true if user has sufficient permissions
 *
 * @example
 * hasPermission('edit', 'admin') // true
 * hasPermission('admin', 'edit') // false
 * hasPermission('view', 'view')  // true
 */
export function hasPermission(
  requiredLevel: PermissionLevel,
  userLevel: PermissionLevel = "none"
): boolean {
  const requiredRank = PERMISSION_HIERARCHY[requiredLevel] ?? 0;
  const userRank = PERMISSION_HIERARCHY[userLevel] ?? 0;
  return userRank >= requiredRank;
}

/**
 * Get the effective permission level for a user on a project
 *
 * @param project - Project with permission information
 * @param currentUser - Currently logged in user (optional)
 * @returns The user's permission level for this project
 */
export function getPermissionLevel(
  project: ProjectWithPermissions,
  currentUser?: User | null
): PermissionLevel {
  if (!currentUser) {
    return "none";
  }

  // Project owner always has 'owner' permission
  if (project.owner_id === currentUser.id) {
    return "owner";
  }

  // Use explicit permission level if provided
  if (project.permission_level) {
    return project.permission_level;
  }

  // Default to 'none' if no permission is set
  return "none";
}

/**
 * Check if user can view the project
 *
 * @param project - Project to check
 * @param currentUser - Currently logged in user
 * @returns true if user can view
 */
export function canUserView(
  project: ProjectWithPermissions,
  currentUser?: User | null
): boolean {
  const level = getPermissionLevel(project, currentUser);
  return hasPermission("view", level);
}

/**
 * Check if user can comment on the project
 *
 * @param project - Project to check
 * @param currentUser - Currently logged in user
 * @returns true if user can comment
 */
export function canUserComment(
  project: ProjectWithPermissions,
  currentUser?: User | null
): boolean {
  const level = getPermissionLevel(project, currentUser);
  return hasPermission("comment", level);
}

/**
 * Check if user can edit the project
 *
 * @param project - Project to check
 * @param currentUser - Currently logged in user
 * @returns true if user can edit
 */
export function canUserEdit(
  project: ProjectWithPermissions,
  currentUser?: User | null
): boolean {
  const level = getPermissionLevel(project, currentUser);
  return hasPermission("edit", level);
}

/**
 * Check if user has admin permissions for the project
 *
 * @param project - Project to check
 * @param currentUser - Currently logged in user
 * @returns true if user can admin
 */
export function canUserAdmin(
  project: ProjectWithPermissions,
  currentUser?: User | null
): boolean {
  const level = getPermissionLevel(project, currentUser);
  return hasPermission("admin", level);
}

/**
 * Check if user is the project owner
 *
 * @param project - Project to check
 * @param currentUser - Currently logged in user
 * @returns true if user is owner
 */
export function isProjectOwner(
  project: ProjectWithPermissions,
  currentUser?: User | null
): boolean {
  if (!currentUser) {
    return false;
  }
  return project.owner_id === currentUser.id;
}

// ============================================================================
// Permission Display Utilities
// ============================================================================

/**
 * Get human-readable label for permission level
 */
export function getPermissionLabel(level: PermissionLevel): string {
  const labels: Record<PermissionLevel, string> = {
    none: "No Access",
    view: "View Only",
    comment: "Can Comment",
    edit: "Can Edit",
    admin: "Admin",
    owner: "Owner",
  };
  return labels[level] ?? "Unknown";
}

/**
 * Get description of what a permission level allows
 */
export function getPermissionDescription(level: PermissionLevel): string {
  const descriptions: Record<PermissionLevel, string> = {
    none: "No access to this project",
    view: "Can view workflows and configurations",
    comment: "Can view and add comments",
    edit: "Can view, comment, and edit workflows",
    admin: "Can manage project settings and permissions",
    owner: "Full control over the project",
  };
  return descriptions[level] ?? "";
}

/**
 * Get all available permission levels (excluding 'none' and 'owner')
 * Used for permission selection in UI
 */
export function getAvailablePermissionLevels(): PermissionLevel[] {
  return ["view", "comment", "edit", "admin"];
}

/**
 * Get permission level options for dropdowns
 */
export function getPermissionLevelOptions(): Array<{
  value: PermissionLevel;
  label: string;
  description: string;
}> {
  return getAvailablePermissionLevels().map((level) => ({
    value: level,
    label: getPermissionLabel(level),
    description: getPermissionDescription(level),
  }));
}

// ============================================================================
// Permission Validation
// ============================================================================

/**
 * Validate that a permission level is valid
 */
export function isValidPermissionLevel(
  level: string
): level is PermissionLevel {
  return ["none", "view", "comment", "edit", "admin", "owner"].includes(level);
}

/**
 * Safely parse a permission level string
 */
export function parsePermissionLevel(level: unknown): PermissionLevel {
  if (typeof level === "string" && isValidPermissionLevel(level)) {
    return level;
  }
  return "none";
}
