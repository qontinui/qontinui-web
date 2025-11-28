"use client";

import * as React from "react";
import { Lock, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  type PermissionLevel,
  type ProjectWithPermissions,
  hasPermission as checkPermission,
  getPermissionLevel,
} from "@/lib/permissions";
import { useAuth } from "@/contexts/auth-context";

/**
 * Legacy permission type for backward compatibility
 * Maps to new PermissionLevel system
 */
export type Permission =
  | "view"
  | "comment"
  | "edit"
  | "delete"
  | "share"
  | "admin"
  | "manage_members";

interface PermissionGateProps {
  children: React.ReactNode;

  // New API - using project and required permission level
  project?: ProjectWithPermissions;
  requiredPermission?:
    | PermissionLevel
    | Permission
    | Array<PermissionLevel | Permission>;

  // Legacy API - for backward compatibility
  userPermissions?: Permission[];
  userRole?: string;

  // Display options
  fallback?: React.ReactNode;
  showMessage?: boolean;
  className?: string;
}

// Permission mapping for legacy support
const permissionToLevel: Record<Permission, PermissionLevel> = {
  view: "view",
  comment: "comment",
  edit: "edit",
  delete: "admin",
  share: "admin",
  admin: "admin",
  manage_members: "owner",
};

// Legacy role permissions for backward compatibility
const rolePermissions: Record<string, Permission[]> = {
  viewer: ["view"],
  commenter: ["view", "comment"],
  editor: ["view", "comment", "edit"],
  admin: ["view", "comment", "edit", "delete", "share", "admin"],
  owner: [
    "view",
    "comment",
    "edit",
    "delete",
    "share",
    "admin",
    "manage_members",
  ],
};

const permissionMessages: Record<string, string> = {
  none: "You need access to this project.",
  view: "You need view permission to access this content.",
  comment: "You need comment permission to add comments.",
  edit: "You need edit permission to modify this content.",
  delete: "You need delete permission to remove this content.",
  share: "You need share permission to share this content.",
  admin: "You need admin permission to perform this action.",
  owner: "You must be the project owner to perform this action.",
  manage_members:
    "You need member management permission to perform this action.",
};

/**
 * PermissionGate component - Shows children only if user has required permission
 *
 * @example
 * // New API - Using with project (recommended)
 * <PermissionGate project={project} requiredPermission="edit">
 *   <EditButton />
 * </PermissionGate>
 *
 * @example
 * // Legacy API - Using with specific permissions (still supported)
 * <PermissionGate requiredPermission="edit" userPermissions={['view', 'edit']}>
 *   <EditButton />
 * </PermissionGate>
 *
 * @example
 * // Legacy API - Using with role (still supported)
 * <PermissionGate requiredPermission="edit" userRole="editor">
 *   <EditButton />
 * </PermissionGate>
 *
 * @example
 * // With custom fallback
 * <PermissionGate
 *   project={project}
 *   requiredPermission="admin"
 *   fallback={<LockedMessage />}
 * >
 *   <DangerZone />
 * </PermissionGate>
 */
export function PermissionGate({
  children,
  project,
  requiredPermission,
  userPermissions,
  userRole,
  fallback,
  showMessage = false,
  className,
}: PermissionGateProps) {
  const { user: currentUser } = useAuth();

  // Check if user has required permission(s)
  const hasPermission = React.useMemo(() => {
    // New API - using project
    if (project && requiredPermission) {
      const userLevel = getPermissionLevel(project, currentUser);
      const required = Array.isArray(requiredPermission)
        ? requiredPermission
        : [requiredPermission];

      // Convert permissions to levels and check
      return required.every((perm) => {
        const requiredLevel =
          typeof perm === "string" && perm in permissionToLevel
            ? permissionToLevel[perm as Permission]
            : (perm as PermissionLevel);
        return checkPermission(requiredLevel, userLevel);
      });
    }

    // Legacy API - using userPermissions or userRole
    const actualPermissions: Permission[] = userPermissions
      ? userPermissions
      : userRole && rolePermissions[userRole]
        ? rolePermissions[userRole]
        : [];

    if (!requiredPermission) {
      return false;
    }

    const required = Array.isArray(requiredPermission)
      ? requiredPermission
      : [requiredPermission];

    // User must have ALL required permissions
    return required.every((permission) =>
      actualPermissions.includes(permission as Permission)
    );
  }, [project, requiredPermission, userPermissions, userRole, currentUser]);

  // If user has permission, render children
  if (hasPermission) {
    return <>{children}</>;
  }

  // If no permission and showMessage is true, show default message
  if (showMessage && requiredPermission) {
    const firstRequired = Array.isArray(requiredPermission)
      ? requiredPermission[0]
      : requiredPermission;
    const message =
      permissionMessages[firstRequired] ||
      "You do not have permission to access this content.";

    return (
      <Alert
        variant="default"
        className={cn("border-muted-foreground/20", className)}
      >
        <Lock className="h-4 w-4" />
        <AlertTitle>Insufficient Permissions</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  }

  // If custom fallback provided, render it
  if (fallback) {
    return <>{fallback}</>;
  }

  // Otherwise, render nothing
  return null;
}

/**
 * usePermission hook - Check permissions in components
 *
 * @example
 * // New API - using project (recommended)
 * const { hasPermission, checkPermission } = usePermission(project);
 * if (checkPermission('edit')) {
 *   // Show edit UI
 * }
 *
 * @example
 * // Legacy API - using role (still supported)
 * const { hasPermission, checkPermission } = usePermission(undefined, userRole, userPermissions);
 * if (checkPermission('edit')) {
 *   // Show edit UI
 * }
 */
export function usePermission(
  project?: ProjectWithPermissions,
  userRole?: string,
  userPermissions?: Permission[]
) {
  const { user: currentUser } = useAuth();

  // New API - using project
  const projectPermissionLevel = React.useMemo(() => {
    if (project) {
      return getPermissionLevel(project, currentUser);
    }
    return "none" as PermissionLevel;
  }, [project, currentUser]);

  // Legacy API - using userPermissions or userRole
  const actualPermissions = React.useMemo(() => {
    if (userPermissions) {
      return userPermissions;
    }
    if (userRole && rolePermissions[userRole]) {
      return rolePermissions[userRole];
    }
    return [];
  }, [userPermissions, userRole]);

  const checkPermissionFn = React.useCallback(
    (permission: Permission | Permission[] | PermissionLevel) => {
      // New API - using project
      if (project) {
        const required = Array.isArray(permission) ? permission : [permission];
        return required.every((perm) => {
          const requiredLevel =
            typeof perm === "string" && perm in permissionToLevel
              ? permissionToLevel[perm as Permission]
              : (perm as PermissionLevel);
          return checkPermission(requiredLevel, projectPermissionLevel);
        });
      }

      // Legacy API
      const required = Array.isArray(permission) ? permission : [permission];
      return required.every((p) => actualPermissions.includes(p as Permission));
    },
    [project, projectPermissionLevel, actualPermissions]
  );

  const hasAnyPermission = React.useCallback(
    (permissions: Permission[]) => {
      if (project) {
        return permissions.some((perm) => {
          const requiredLevel = permissionToLevel[perm];
          return checkPermission(requiredLevel, projectPermissionLevel);
        });
      }
      return permissions.some((p) => actualPermissions.includes(p));
    },
    [project, projectPermissionLevel, actualPermissions]
  );

  return {
    permissions: actualPermissions,
    permissionLevel: projectPermissionLevel,
    hasPermission: checkPermissionFn,
    hasAnyPermission,
    checkPermission: checkPermissionFn,
  };
}

/**
 * PermissionBoundary component - Error boundary for permission-related errors
 */
interface PermissionBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface PermissionBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class PermissionBoundary extends React.Component<
  PermissionBoundaryProps,
  PermissionBoundaryState
> {
  constructor(props: PermissionBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PermissionBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Permission error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Permission Error</AlertTitle>
          <AlertDescription>
            An error occurred while checking permissions. Please try again.
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}
