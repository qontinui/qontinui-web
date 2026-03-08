"use client";

import {
  Users,
  Eye,
  Mail,
  Edit,
  Shield,
  X,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import type { PermissionLevel, Collaborator } from "@/types/collaboration";
import { permissionColors } from "../share-dialog-types";

const permissionIconComponents = {
  view: Eye,
  comment: Mail,
  edit: Edit,
  admin: Shield,
  owner: Shield,
  none: X,
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface CollaboratorRowProps {
  collaborator: Collaborator;
  isUpdating: boolean;
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => void;
  onRevoke: (collaboratorId: string, collaboratorEmail: string) => void;
}

function CollaboratorRow({
  collaborator,
  isUpdating,
  onChangePermission,
  onRevoke,
}: CollaboratorRowProps) {
  const PermissionIcon = permissionIconComponents[collaborator.permission];
  const isOwner = collaborator.permission === "owner";

  return (
    <div className="flex items-center justify-between gap-3 p-3 border border-border-subtle rounded-lg bg-surface-canvas/50">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar
          fallback={
            <span className="text-xs font-medium">
              {getInitials(collaborator.name || collaborator.email)}
            </span>
          }
          className="h-8 w-8 bg-surface-raised"
        />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-medium truncate text-sm">
            {collaborator.name || collaborator.email}
          </span>
          <span className="text-xs text-text-muted truncate">
            {collaborator.email}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isOwner ? (
          <Badge
            className={cn("w-[120px] justify-center", permissionColors.owner)}
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
                onChangePermission(collaborator.id, value as PermissionLevel)
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
                <SelectItem value="comment">Can Comment</SelectItem>
                <SelectItem value="edit">Can Edit</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-950/30"
              onClick={() => onRevoke(collaborator.id, collaborator.email)}
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
}

interface CollaboratorListProps {
  collaborators: Collaborator[];
  actionLoading: string | null;
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => void;
  onRevoke: (collaboratorId: string, collaboratorEmail: string) => void;
}

export function CollaboratorList({
  collaborators,
  actionLoading,
  onChangePermission,
  onRevoke,
}: CollaboratorListProps) {
  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2 text-base">
        <Users className="h-4 w-4" />
        Current Collaborators ({collaborators.length})
      </Label>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {collaborators.map((collaborator) => (
          <CollaboratorRow
            key={collaborator.id}
            collaborator={collaborator}
            isUpdating={actionLoading === collaborator.id}
            onChangePermission={onChangePermission}
            onRevoke={onRevoke}
          />
        ))}
        {collaborators.length === 0 && (
          <div className="text-center py-12 text-text-muted border border-border-subtle rounded-lg bg-surface-canvas/30">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No collaborators yet</p>
            <p className="text-xs mt-1">Share this project to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
