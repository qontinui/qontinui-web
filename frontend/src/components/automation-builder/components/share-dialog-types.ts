import type {
  PermissionLevel,
  Collaborator,
  Organization,
} from "@/types/collaboration";

export interface ShareProjectDialogProps {
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

export type ShareMode = "user" | "organization";

export const permissionColors: Record<PermissionLevel, string> = {
  view: "bg-gray-500/10 text-text-muted border-gray-500/20",
  comment: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  edit: "bg-green-500/10 text-green-500 border-green-500/20",
  admin: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  owner: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  none: "bg-red-500/10 text-red-500 border-red-500/20",
};
