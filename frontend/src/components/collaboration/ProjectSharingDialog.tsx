"use client";

import { Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useProjectSharing } from "./_hooks/useProjectSharing";
import { ShareModeTabs } from "./_components/ShareModeTabs";
import { UserShareForm } from "./_components/UserShareForm";
import { OrgShareForm } from "./_components/OrgShareForm";
import { ShareLinkSection } from "./_components/ShareLinkSection";
import { SharingCollaboratorList } from "./_components/SharingCollaboratorList";
import type { ProjectSharingDialogProps } from "./_types/project-sharing";

export type {
  PermissionLevel,
  Collaborator,
  Organization,
} from "./_types/project-sharing";

export function ProjectSharingDialog({
  open,
  onOpenChange,
  projectId: _projectId,
  collaborators,
  organizations,
  shareLink,
  onAddUser,
  onAddOrganization,
  onChangePermission,
  onRevoke,
  onGenerateLink,
}: ProjectSharingDialogProps) {
  const {
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
  } = useProjectSharing({
    shareLink,
    organizations,
    onAddUser,
    onAddOrganization,
    onChangePermission,
    onRevoke,
    onGenerateLink,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] flex flex-col"
        data-ui-id="dialog-project-sharing"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Project
          </DialogTitle>
          <DialogDescription>
            Share this project with team members or your organization
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ShareModeTabs
            shareMode={shareMode}
            onShareModeChange={setShareMode}
          />

          {shareMode === "user" && (
            <UserShareForm
              emailInput={emailInput}
              onEmailChange={setEmailInput}
              selectedPermission={selectedPermission}
              onPermissionChange={setSelectedPermission}
              loading={loading}
              onSubmit={handleAddUser}
            />
          )}

          {shareMode === "organization" && (
            <OrgShareForm
              organizations={organizations}
              selectedOrg={selectedOrg}
              onOrgChange={setSelectedOrg}
              selectedPermission={selectedPermission}
              onPermissionChange={setSelectedPermission}
              loading={loading}
              onSubmit={handleAddOrganization}
            />
          )}
        </div>

        <Separator />

        <ShareLinkSection
          generatedLink={generatedLink}
          linkCopied={linkCopied}
          loading={loading}
          onCopyLink={handleCopyLink}
        />

        <Separator />

        <SharingCollaboratorList
          collaborators={collaborators}
          actionLoading={actionLoading}
          onChangePermission={handleChangePermission}
          onRevoke={handleRevoke}
        />
      </DialogContent>
    </Dialog>
  );
}
