"use client";

import * as React from "react";
import {
  Share2,
  Users,
  Check,
  Copy,
  Trash2,
  Building2,
  Mail,
  Shield,
  Eye,
  Edit,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type PermissionLevel = "view" | "comment" | "edit" | "admin";

export interface Collaborator {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  permission: PermissionLevel;
  type: "user" | "organization";
}

export interface Organization {
  id: string;
  name: string;
  avatar_url?: string;
}

interface ProjectSharingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  collaborators: Collaborator[];
  organizations: Organization[];
  shareLink?: string;
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

const permissionIcons = {
  view: Eye,
  comment: Mail,
  edit: Edit,
  admin: Shield,
};

const permissionColors = {
  view: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  comment: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  edit: "bg-green-500/10 text-green-500 border-green-500/20",
  admin: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

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

  const handleAddUser = async () => {
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
  };

  const handleAddOrganization = async () => {
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
  };

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
    collaboratorName: string
  ) => {
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
  };

  const handleCopyLink = async () => {
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
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Project
          </DialogTitle>
          <DialogDescription>
            Share this project with team members or your organization
          </DialogDescription>
        </DialogHeader>

        {/* Share Options */}
        <div className="space-y-4">
          {/* Mode Tabs */}
          <div className="flex gap-2 p-1 bg-muted rounded-lg">
            <Button
              variant={shareMode === "user" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShareMode("user")}
              className="flex-1"
            >
              <Mail className="mr-2 h-4 w-4" />
              Specific User
            </Button>
            <Button
              variant={shareMode === "organization" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShareMode("organization")}
              className="flex-1"
            >
              <Building2 className="mr-2 h-4 w-4" />
              Organization
            </Button>
          </div>

          {/* User Share */}
          {shareMode === "user" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  disabled={loading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddUser();
                    }
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Select
                  value={selectedPermission}
                  onValueChange={(value) =>
                    setSelectedPermission(value as PermissionLevel)
                  }
                  disabled={loading}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">Can View</SelectItem>
                    <SelectItem value="comment">Can Comment</SelectItem>
                    <SelectItem value="edit">Can Edit</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAddUser}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Share
                </Button>
              </div>
            </div>
          )}

          {/* Organization Share */}
          {shareMode === "organization" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="organization">Organization</Label>
                <Select
                  value={selectedOrg}
                  onValueChange={setSelectedOrg}
                  disabled={loading}
                >
                  <SelectTrigger id="organization">
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Select
                  value={selectedPermission}
                  onValueChange={(value) =>
                    setSelectedPermission(value as PermissionLevel)
                  }
                  disabled={loading}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">Can View</SelectItem>
                    <SelectItem value="comment">Can Comment</SelectItem>
                    <SelectItem value="edit">Can Edit</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAddOrganization}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Share
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Share Link */}
        <div className="space-y-2">
          <Label>Share Link</Label>
          <div className="flex gap-2">
            <Input
              value={generatedLink || "Generate a shareable link"}
              readOnly
              className="flex-1"
            />
            <Button
              onClick={handleCopyLink}
              disabled={loading}
              variant={linkCopied ? "default" : "outline"}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : linkCopied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone with this link can view the project
          </p>
        </div>

        <Separator />

        {/* Current Collaborators */}
        <div className="space-y-3 flex-1 overflow-y-auto">
          <Label className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Current Collaborators ({collaborators.length})
          </Label>
          <div className="space-y-2">
            {collaborators.map((collaborator) => {
              const PermissionIcon = permissionIcons[collaborator.permission];
              const isUpdating = actionLoading === collaborator.id;

              return (
                <div
                  key={collaborator.id}
                  className="flex items-center justify-between gap-3 p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar
                      src={collaborator.avatar_url}
                      fallback={
                        collaborator.type === "organization" ? (
                          <Building2 className="h-4 w-4" />
                        ) : (
                          <span className="text-xs font-medium">
                            {getInitials(collaborator.name)}
                          </span>
                        )
                      }
                      className="h-8 w-8"
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-medium truncate">
                        {collaborator.name}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {collaborator.email}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={collaborator.permission}
                      onValueChange={(value) =>
                        handleChangePermission(
                          collaborator.id,
                          value as PermissionLevel
                        )
                      }
                      disabled={isUpdating}
                    >
                      <SelectTrigger
                        className={cn(
                          "w-[130px]",
                          permissionColors[collaborator.permission]
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <PermissionIcon className="h-3 w-3" />
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view">Can View</SelectItem>
                        <SelectItem value="comment">Can Comment</SelectItem>
                        <SelectItem value="edit">Can Edit</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        handleRevoke(collaborator.id, collaborator.name)
                      }
                      disabled={isUpdating}
                      aria-label={`Remove ${collaborator.name}`}
                    >
                      {isUpdating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
            {collaborators.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No collaborators yet
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
