import * as React from "react";
import { toast } from "sonner";
import type { PermissionLevel, Organization } from "../_types/project-sharing";

interface UseProjectSharingOptions {
  shareLink?: string;
  organizations: Organization[];
  onAddUser: (email: string, permission: PermissionLevel) => Promise<void>;
  onAddOrganization: (
    orgId: string,
    permission: PermissionLevel
  ) => Promise<void>;
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => Promise<void>;
  onRevoke: (collaboratorId: string) => Promise<void>;
  onGenerateLink: () => Promise<string>;
}

export function useProjectSharing({
  shareLink,
  organizations,
  onAddUser,
  onAddOrganization,
  onChangePermission,
  onRevoke,
  onGenerateLink,
}: UseProjectSharingOptions) {
  const [shareMode, setShareMode] = React.useState<"user" | "organization">(
    "user"
  );
  const [emailInput, setEmailInput] = React.useState("");
  const [selectedOrg, setSelectedOrg] = React.useState("");
  const [selectedPermission, setSelectedPermission] =
    React.useState<PermissionLevel>("view");
  const [loading, setLoading] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [generatedLink, setGeneratedLink] = React.useState(shareLink);

  const handleAddUser = React.useCallback(async () => {
    if (!emailInput.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    setLoading(true);
    try {
      await onAddUser(emailInput, selectedPermission);
      toast.success(`Shared with ${emailInput}`);
      setEmailInput("");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to share project"
      );
    } finally {
      setLoading(false);
    }
  }, [emailInput, selectedPermission, onAddUser]);

  const handleAddOrganization = React.useCallback(async () => {
    if (!selectedOrg) {
      toast.error("Please select an organization");
      return;
    }

    setLoading(true);
    try {
      await onAddOrganization(selectedOrg, selectedPermission);
      const org = organizations.find((o) => o.id === selectedOrg);
      toast.success(`Shared with ${org?.name}`);
      setSelectedOrg("");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to share project"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedOrg, selectedPermission, onAddOrganization, organizations]);

  const handleChangePermission = React.useCallback(
    async (collaboratorId: string, permission: PermissionLevel) => {
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
    },
    [onChangePermission]
  );

  const handleRevoke = React.useCallback(
    async (collaboratorId: string, collaboratorName: string) => {
      if (!confirm(`Remove access for ${collaboratorName}?`)) return;
      setActionLoading(collaboratorId);
      try {
        await onRevoke(collaboratorId);
        toast.success("Access revoked");
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : "Failed to revoke access"
        );
      } finally {
        setActionLoading(null);
      }
    },
    [onRevoke]
  );

  const handleCopyLink = React.useCallback(async () => {
    if (!generatedLink) {
      setLoading(true);
      try {
        const link = await onGenerateLink();
        setGeneratedLink(link);
        await navigator.clipboard.writeText(link);
        setLinkCopied(true);
        toast.success("Link copied to clipboard");
        setTimeout(() => setLinkCopied(false), 2000);
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : "Failed to generate link"
        );
      } finally {
        setLoading(false);
      }
    } else {
      await navigator.clipboard.writeText(generatedLink);
      setLinkCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [generatedLink, onGenerateLink]);

  return {
    shareMode,
    setShareMode,
    emailInput,
    setEmailInput,
    selectedOrg,
    setSelectedOrg,
    selectedPermission,
    setSelectedPermission,
    loading,
    actionLoading,
    linkCopied,
    generatedLink,
    handleAddUser,
    handleAddOrganization,
    handleChangePermission,
    handleRevoke,
    handleCopyLink,
  };
}
