import * as React from "react";
import { toast } from "sonner";
import type { PermissionLevel } from "@/types/collaboration";

interface UseCollaboratorActionsOptions {
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => Promise<void>;
  onRevoke: (collaboratorId: string) => Promise<void>;
}

export function useCollaboratorActions({
  onChangePermission,
  onRevoke,
}: UseCollaboratorActionsOptions) {
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  const handleChangePermission = async (
    collaboratorId: string,
    permission: PermissionLevel
  ) => {
    setActionLoading(collaboratorId);
    try {
      await onChangePermission(collaboratorId, permission);
      toast.success("Permission updated");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update permission"
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async (
    collaboratorId: string,
    collaboratorEmail: string
  ) => {
    setActionLoading(collaboratorId);
    try {
      await onRevoke(collaboratorId);
      toast.success(`Revoked access for ${collaboratorEmail}`);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to revoke access"
      );
    } finally {
      setActionLoading(null);
    }
  };

  return {
    actionLoading,
    handleChangePermission,
    handleRevoke,
  };
}
