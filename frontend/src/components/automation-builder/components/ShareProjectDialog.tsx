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
import type { ShareProjectDialogProps } from "./share-dialog-types";
import { useShareForm } from "./_hooks/useShareForm";
import { useCollaboratorActions } from "./_hooks/useCollaboratorActions";
import { useShareLink } from "./_hooks/useShareLink";
import { ShareModeSelector } from "./_components/ShareModeSelector";
import { UserShareForm } from "./_components/UserShareForm";
import { OrgShareForm } from "./_components/OrgShareForm";
import { ShareLinkSection } from "./_components/ShareLinkSection";
import { CollaboratorList } from "./_components/CollaboratorList";

export type { ShareProjectDialogProps };

export function ShareProjectDialog({
  open,
  onOpenChange,
  projectName,
  collaborators,
  organizations,
  shareLink,
  onAddUser,
  onAddOrganization,
  onChangePermission,
  onRevoke,
  onGenerateLink,
}: ShareProjectDialogProps) {
  const form = useShareForm({ organizations, onAddUser, onAddOrganization });
  const collabActions = useCollaboratorActions({
    onChangePermission,
    onRevoke,
  });
  const link = useShareLink({ initialLink: shareLink, onGenerateLink });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        data-ui-id="dialog-share-project"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share {projectName ? `"${projectName}"` : "Project"}
          </DialogTitle>
          <DialogDescription>
            Share this project with team members or your organization
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1">
          <div className="space-y-4">
            <ShareModeSelector
              shareMode={form.shareMode}
              onShareModeChange={form.setShareMode}
            />

            {form.shareMode === "user" && (
              <UserShareForm
                emailInput={form.emailInput}
                onEmailChange={form.setEmailInput}
                selectedPermission={form.selectedPermission}
                onPermissionChange={form.setSelectedPermission}
                expirationDate={form.expirationDate}
                onExpirationChange={form.setExpirationDate}
                loading={form.loading}
                onSubmit={form.handleAddUser}
              />
            )}

            {form.shareMode === "organization" && (
              <OrgShareForm
                organizations={organizations}
                selectedOrg={form.selectedOrg}
                onOrgChange={form.setSelectedOrg}
                selectedPermission={form.selectedPermission}
                onPermissionChange={form.setSelectedPermission}
                expirationDate={form.expirationDate}
                onExpirationChange={form.setExpirationDate}
                loading={form.loading}
                onSubmit={form.handleAddOrganization}
              />
            )}
          </div>

          {onGenerateLink && (
            <ShareLinkSection
              generatedLink={link.generatedLink}
              linkCopied={link.linkCopied}
              loading={link.linkLoading}
              onCopyLink={link.handleCopyLink}
            />
          )}

          <Separator />

          <CollaboratorList
            collaborators={collaborators}
            actionLoading={collabActions.actionLoading}
            onChangePermission={collabActions.handleChangePermission}
            onRevoke={collabActions.handleRevoke}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
