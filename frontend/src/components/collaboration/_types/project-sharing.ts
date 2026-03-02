import type { LucideIcon } from "lucide-react";
import { Eye, Mail, Edit, Shield } from "lucide-react";

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

export interface ProjectSharingDialogProps {
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

export const permissionIcons: Record<PermissionLevel, LucideIcon> = {
  view: Eye,
  comment: Mail,
  edit: Edit,
  admin: Shield,
};

export const permissionColors: Record<PermissionLevel, string> = {
  view: "bg-gray-500/10 text-text-muted border-gray-500/20",
  comment: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  edit: "bg-green-500/10 text-green-500 border-green-500/20",
  admin: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
