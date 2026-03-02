import * as React from "react";
import { toast } from "sonner";
import type { PermissionLevel, Organization } from "@/types/collaboration";
import type { ShareMode } from "../share-dialog-types";

interface UseShareFormOptions {
  organizations: Organization[];
  onAddUser: (
    email: string,
    permission: PermissionLevel,
    expiresAt?: string
  ) => Promise<void>;
  onAddOrganization: (
    orgId: string,
    permission: PermissionLevel,
    expiresAt?: string
  ) => Promise<void>;
}

export function useShareForm({
  organizations,
  onAddUser,
  onAddOrganization,
}: UseShareFormOptions) {
  const [shareMode, setShareMode] = React.useState<ShareMode>("user");
  const [emailInput, setEmailInput] = React.useState("");
  const [selectedOrg, setSelectedOrg] = React.useState("");
  const [selectedPermission, setSelectedPermission] =
    React.useState<PermissionLevel>("view");
  const [expirationDate, setExpirationDate] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleAddUser = async () => {
    if (!emailInput.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    setLoading(true);
    try {
      await onAddUser(
        emailInput,
        selectedPermission,
        expirationDate || undefined
      );
      toast.success(`Shared with ${emailInput}`);
      setEmailInput("");
      setExpirationDate("");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to share project"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddOrganization = async () => {
    if (!selectedOrg) {
      toast.error("Please select an organization");
      return;
    }

    setLoading(true);
    try {
      await onAddOrganization(
        selectedOrg,
        selectedPermission,
        expirationDate || undefined
      );
      const org = organizations.find((o) => o.id === selectedOrg);
      toast.success(`Shared with ${org?.name}`);
      setSelectedOrg("");
      setExpirationDate("");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to share project"
      );
    } finally {
      setLoading(false);
    }
  };

  return {
    shareMode,
    setShareMode,
    emailInput,
    setEmailInput,
    selectedOrg,
    setSelectedOrg,
    selectedPermission,
    setSelectedPermission,
    expirationDate,
    setExpirationDate,
    loading,
    handleAddUser,
    handleAddOrganization,
  };
}
