'use client';

import * as React from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export type Permission =
  | 'view'
  | 'comment'
  | 'edit'
  | 'delete'
  | 'share'
  | 'admin'
  | 'manage_members';

export type PermissionLevel = 'viewer' | 'commenter' | 'editor' | 'admin' | 'owner';

interface PermissionGateProps {
  children: React.ReactNode;
  requiredPermission: Permission | Permission[];
  userPermissions?: Permission[];
  userRole?: PermissionLevel;
  fallback?: React.ReactNode;
  showMessage?: boolean;
  className?: string;
}

// Permission hierarchy
const rolePermissions: Record<PermissionLevel, Permission[]> = {
  viewer: ['view'],
  commenter: ['view', 'comment'],
  editor: ['view', 'comment', 'edit'],
  admin: ['view', 'comment', 'edit', 'delete', 'share', 'admin'],
  owner: ['view', 'comment', 'edit', 'delete', 'share', 'admin', 'manage_members'],
};

const permissionMessages: Record<Permission, string> = {
  view: 'You need view permission to access this content.',
  comment: 'You need comment permission to add comments.',
  edit: 'You need edit permission to modify this content.',
  delete: 'You need delete permission to remove this content.',
  share: 'You need share permission to share this content.',
  admin: 'You need admin permission to perform this action.',
  manage_members: 'You need member management permission to perform this action.',
};

/**
 * PermissionGate component - Shows children only if user has required permission
 *
 * @example
 * // Using with specific permissions
 * <PermissionGate requiredPermission="edit" userPermissions={['view', 'edit']}>
 *   <EditButton />
 * </PermissionGate>
 *
 * @example
 * // Using with role
 * <PermissionGate requiredPermission="edit" userRole="editor">
 *   <EditButton />
 * </PermissionGate>
 *
 * @example
 * // With custom fallback
 * <PermissionGate
 *   requiredPermission={['edit', 'delete']}
 *   userRole="viewer"
 *   fallback={<LockedMessage />}
 * >
 *   <DangerZone />
 * </PermissionGate>
 */
export function PermissionGate({
  children,
  requiredPermission,
  userPermissions,
  userRole,
  fallback,
  showMessage = false,
  className,
}: PermissionGateProps) {
  // Determine user's actual permissions
  const actualPermissions = React.useMemo(() => {
    if (userPermissions) {
      return userPermissions;
    }
    if (userRole) {
      return rolePermissions[userRole] || [];
    }
    return [];
  }, [userPermissions, userRole]);

  // Check if user has required permission(s)
  const hasPermission = React.useMemo(() => {
    const required = Array.isArray(requiredPermission)
      ? requiredPermission
      : [requiredPermission];

    // User must have ALL required permissions
    return required.every((permission) =>
      actualPermissions.includes(permission)
    );
  }, [requiredPermission, actualPermissions]);

  // If user has permission, render children
  if (hasPermission) {
    return <>{children}</>;
  }

  // If no permission and showMessage is true, show default message
  if (showMessage) {
    const firstRequired = Array.isArray(requiredPermission)
      ? requiredPermission[0]
      : requiredPermission;
    const message =
      permissionMessages[firstRequired] ||
      'You do not have permission to access this content.';

    return (
      <Alert variant="default" className={cn('border-muted-foreground/20', className)}>
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
 * const { hasPermission, checkPermission } = usePermission(userRole, userPermissions);
 *
 * if (checkPermission('edit')) {
 *   // Show edit UI
 * }
 */
export function usePermission(
  userRole?: PermissionLevel,
  userPermissions?: Permission[]
) {
  const actualPermissions = React.useMemo(() => {
    if (userPermissions) {
      return userPermissions;
    }
    if (userRole) {
      return rolePermissions[userRole] || [];
    }
    return [];
  }, [userPermissions, userRole]);

  const checkPermission = React.useCallback(
    (permission: Permission | Permission[]) => {
      const required = Array.isArray(permission) ? permission : [permission];
      return required.every((p) => actualPermissions.includes(p));
    },
    [actualPermissions]
  );

  const hasAnyPermission = React.useCallback(
    (permissions: Permission[]) => {
      return permissions.some((p) => actualPermissions.includes(p));
    },
    [actualPermissions]
  );

  return {
    permissions: actualPermissions,
    hasPermission: checkPermission,
    hasAnyPermission,
    checkPermission,
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
    console.error('Permission error:', error, errorInfo);
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
