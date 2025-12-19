"use client";

import * as React from "react";
import {
  Share2,
  Users,
  Copy,
  Trash2,
  Building2,
  Mail,
  Shield,
  Eye,
  Edit,
  Loader2,
  Calendar,
  X,
  Check,
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
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  PermissionLevel,
  Collaborator,
  Organization,
} from "@/types/collaboration";

interface ShareProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
  collaborators: Collaborator[];
  organizations: Organization[];
  shareLink?: string;
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
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => Promise<void>;
  onRevoke: (collaboratorId: string) => Promise<void>;
  onGenerateLink?: () => Promise<string>;
}

const permissionIcons = {
  view: Eye,
  comment: Mail,
  edit: Edit,
  admin: Shield,
  owner: Shield,
  none: X,
};

const permissionColors = {
  view: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  comment: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  edit: "bg-green-500/10 text-green-500 border-green-500/20",
  admin: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  owner: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  none: "bg-red-500/10 text-red-500 border-red-500/20",
};

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
  const [shareMode, setShareMode] = React.useState<"user" | "organization">(
    "user"
  );
  const [emailInput, setEmailInput] = React.useState("");
  const [selectedOrg, setSelectedOrg] = React.useState("");
  const [selectedPermission, setSelectedPermission] =
    React.useState<PermissionLevel>("view");
  const [expirationDate, setExpirationDate] = React.useState("");
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
      await onAddUser(
        emailInput,
        selectedPermission,
        expirationDate || undefined
      );
      toast.success(`Shared with ${emailInput}`);
      setEmailInput("");
      setExpirationDate("");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to share project");
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
      toast.error(error instanceof Error ? error.message : "Failed to share project");
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
      toast.error(error instanceof Error ? error.message : "Failed to update permission");
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
      toast.error(error instanceof Error ? error.message : "Failed to revoke access");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyLink = async () => {
    if (!onGenerateLink) {
      toast.error("Link generation not available");
      return;
    }

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
        toast.error(error instanceof Error ? error.message : "Failed to generate link");
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
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
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
          {/* Share Options */}
          <div className="space-y-4">
            {/* Mode Tabs */}
            <div className="flex gap-2 p-1 bg-gray-900 rounded-lg border border-gray-800">
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="permission">Permission Level</Label>
                    <Select
                      value={selectedPermission}
                      onValueChange={(value) =>
                        setSelectedPermission(value as PermissionLevel)
                      }
                      disabled={loading}
                    >
                      <SelectTrigger id="permission">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view">Can View</SelectItem>
                        <SelectItem value="comment">Can Comment</SelectItem>
                        <SelectItem value="edit">Can Edit</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expiration">Expires (Optional)</Label>
                    <div className="relative">
                      <Input
                        id="expiration"
                        type="date"
                        value={expirationDate}
                        onChange={(e) => setExpirationDate(e.target.value)}
                        disabled={loading}
                        min={new Date().toISOString().split("T")[0]}
                        className="pr-8"
                      />
                      <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleAddUser}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Share
                </Button>
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="org-permission">Permission Level</Label>
                    <Select
                      value={selectedPermission}
                      onValueChange={(value) =>
                        setSelectedPermission(value as PermissionLevel)
                      }
                      disabled={loading}
                    >
                      <SelectTrigger id="org-permission">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view">Can View</SelectItem>
                        <SelectItem value="comment">Can Comment</SelectItem>
                        <SelectItem value="edit">Can Edit</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-expiration">Expires (Optional)</Label>
                    <div className="relative">
                      <Input
                        id="org-expiration"
                        type="date"
                        value={expirationDate}
                        onChange={(e) => setExpirationDate(e.target.value)}
                        disabled={loading}
                        min={new Date().toISOString().split("T")[0]}
                        className="pr-8"
                      />
                      <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleAddOrganization}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Share
                </Button>
              </div>
            )}
          </div>

          {onGenerateLink && (
            <>
              <Separator />
              {/* Share Link */}
              <div className="space-y-2">
                <Label>Share Link</Label>
                <div className="flex gap-2">
                  <Input
                    value={generatedLink || "Generate a shareable link"}
                    readOnly
                    className="flex-1 font-mono text-sm"
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
                <p className="text-xs text-gray-400">
                  Anyone with this link can view the project
                </p>
              </div>
            </>
          )}

          <Separator />

          {/* Current Collaborators */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Current Collaborators ({collaborators.length})
            </Label>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {collaborators.map((collaborator) => {
                const PermissionIcon = permissionIcons[collaborator.permission];
                const isUpdating = actionLoading === collaborator.id;
                const isOwner = collaborator.permission === "owner";

                return (
                  <div
                    key={collaborator.id}
                    className="flex items-center justify-between gap-3 p-3 border border-gray-800 rounded-lg bg-gray-950/50"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Avatar
                        fallback={
                          <span className="text-xs font-medium">
                            {getInitials(
                              collaborator.name || collaborator.email
                            )}
                          </span>
                        }
                        className="h-8 w-8 bg-gray-800"
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium truncate text-sm">
                          {collaborator.name || collaborator.email}
                        </span>
                        <span className="text-xs text-gray-400 truncate">
                          {collaborator.email}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isOwner ? (
                        <Badge
                          className={cn(
                            "w-[120px] justify-center",
                            permissionColors.owner
                          )}
                          variant="outline"
                        >
                          <PermissionIcon className="h-3 w-3 mr-1" />
                          Owner
                        </Badge>
                      ) : (
                        <>
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
                                "w-[120px] h-8 text-xs",
                                permissionColors[collaborator.permission]
                              )}
                            >
                              <div className="flex items-center gap-1.5">
                                <PermissionIcon className="h-3 w-3" />
                                <SelectValue />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="view">Can View</SelectItem>
                              <SelectItem value="comment">
                                Can Comment
                              </SelectItem>
                              <SelectItem value="edit">Can Edit</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-950/30"
                            onClick={() =>
                              handleRevoke(collaborator.id, collaborator.email)
                            }
                            disabled={isUpdating}
                            aria-label={`Remove ${collaborator.name || collaborator.email}`}
                          >
                            {isUpdating ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {collaborators.length === 0 && (
                <div className="text-center py-12 text-gray-400 border border-gray-800 rounded-lg bg-gray-950/30">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No collaborators yet</p>
                  <p className="text-xs mt-1">
                    Share this project to get started
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
