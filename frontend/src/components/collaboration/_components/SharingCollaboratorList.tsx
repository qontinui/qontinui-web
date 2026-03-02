import { Users, Building2, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PermissionSelect } from "./PermissionSelect";
import type { PermissionLevel, Collaborator } from "../_types/project-sharing";
import {
  permissionIcons,
  permissionColors,
  getInitials,
} from "../_types/project-sharing";

interface SharingCollaboratorListProps {
  collaborators: Collaborator[];
  actionLoading: string | null;
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => void;
  onRevoke: (collaboratorId: string, collaboratorName: string) => void;
}

export function SharingCollaboratorList({
  collaborators,
  actionLoading,
  onChangePermission,
  onRevoke,
}: SharingCollaboratorListProps) {
  return (
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
                <PermissionSelect
                  value={collaborator.permission}
                  onValueChange={(value) =>
                    onChangePermission(collaborator.id, value)
                  }
                  disabled={isUpdating}
                  triggerClassName={cn(
                    "w-[130px]",
                    permissionColors[collaborator.permission]
                  )}
                >
                  <div className="flex items-center gap-2">
                    <PermissionIcon className="h-3 w-3" />
                    <SelectValue />
                  </div>
                </PermissionSelect>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRevoke(collaborator.id, collaborator.name)}
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
  );
}
