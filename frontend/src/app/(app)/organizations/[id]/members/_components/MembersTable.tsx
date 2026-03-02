import { Button } from "@/components/ui/button";
import { UserPlus, Mail, Edit, Trash2 } from "lucide-react";
import type { TeamMember } from "@/types/collaboration";
import { RoleBadge } from "./RoleBadge";

function getRelativeTime(dateString: string | null) {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60)
  );

  if (diffInHours < 1) return "Just now";
  if (diffInHours < 24) return `${diffInHours} hours ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) return "1 day ago";
  if (diffInDays < 30) return `${diffInDays} days ago`;
  return new Date(dateString).toLocaleDateString();
}

interface MembersTableProps {
  members: TeamMember[];
  canManageMembers: boolean;
  onInvite: () => void;
  onEditRole: (member: TeamMember) => void;
  onRemove: (member: TeamMember) => void;
}

export function MembersTable({
  members,
  canManageMembers,
  onInvite,
  onEditRole,
  onRemove,
}: MembersTableProps) {
  if (members.length === 0) {
    return (
      <div className="text-center py-12">
        <Mail className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-4">No members yet</p>
        {canManageMembers && (
          <Button
            onClick={onInvite}
            className="bg-primary text-primary-foreground"
            size="sm"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite First Member
          </Button>
        )}
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
        <tr>
          <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
            Member
          </th>
          <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
            Email
          </th>
          <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
            Role
          </th>
          <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
            Joined
          </th>
          <th className="text-left text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
            Last Active
          </th>
          {canManageMembers && (
            <th className="text-right text-xs text-muted-foreground uppercase tracking-wider font-medium px-6 py-2">
              Actions
            </th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {members.map((member) => (
          <tr key={member.id} className="hover:bg-muted/50 transition-colors">
            <td className="px-6 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {(member.name || member.email).charAt(0).toUpperCase()}
                </div>
                <span className="font-medium text-sm">
                  {member.name || "Unknown User"}
                </span>
              </div>
            </td>
            <td className="px-6 py-3 text-sm text-muted-foreground">
              {member.email}
            </td>
            <td className="px-6 py-3">
              <RoleBadge role={member.role} />
            </td>
            <td className="px-6 py-3 text-sm text-muted-foreground">
              {getRelativeTime(member.joined_at)}
            </td>
            <td className="px-6 py-3 text-sm text-muted-foreground">
              {getRelativeTime(member.last_active)}
            </td>
            {canManageMembers && (
              <td className="px-6 py-3 text-right">
                {member.role !== "owner" && (
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onEditRole(member)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemove(member)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
