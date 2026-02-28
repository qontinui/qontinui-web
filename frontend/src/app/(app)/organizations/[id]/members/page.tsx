"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  UserPlus,
  Mail,
  Loader2,
  Trash2,
  Edit,
  Crown,
  Shield,
  User,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Organization,
  TeamMember,
  MemberRole,
} from "@/types/collaboration";

export default function MembersPage() {
  const router = useRouter();
  const params = useParams();
  const orgId = params?.id as string;

  const { user, loading: authLoading } = useAuth();
  const {
    switchOrg,
    members,
    getMembers,
    inviteMember,
    updateMemberRole,
    removeMember,
  } = useOrganization();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [inviting, setInviting] = useState(false);

  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<MemberRole>("member");
  const [updating, setUpdating] = useState(false);

  const [removeMemberData, setRemoveMemberData] = useState<TeamMember | null>(
    null
  );
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!orgId || !user) return;

    const loadData = async () => {
      setLoading(true);

      try {
        await switchOrg(orgId);
        const org = await organizationService.getOrganization(orgId);
        setOrganization(org);
        await getMembers(orgId);
      } catch (err) {
        console.error("Failed to load organization:", err);
        toast.error("Failed to load organization");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orgId, user, switchOrg, getMembers]);

  const handleInvite = async () => {
    if (!inviteEmail || !orgId) return;

    setInviting(true);
    try {
      await inviteMember(orgId, inviteEmail, inviteRole);
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      await getMembers(orgId);
    } catch (err: unknown) {
      console.error("Failed to invite member:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to send invitation"
      );
    } finally {
      setInviting(false);
    }
  };

  const handleEditRole = (member: TeamMember) => {
    setEditMember(member);
    setEditRole(member.role);
    setEditDialogOpen(true);
  };

  const handleUpdateRole = async () => {
    if (!editMember || !orgId) return;

    setUpdating(true);
    try {
      await updateMemberRole(orgId, editMember.user_id, editRole);
      toast.success("Member role updated successfully");
      setEditDialogOpen(false);
      setEditMember(null);
      await getMembers(orgId);
    } catch (err: unknown) {
      console.error("Failed to update role:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to update member role"
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleRemoveClick = (member: TeamMember) => {
    setRemoveMemberData(member);
    setRemoveDialogOpen(true);
  };

  const handleRemove = async () => {
    if (!removeMemberData || !orgId) return;

    setRemoving(true);
    try {
      await removeMember(orgId, removeMemberData.user_id);
      toast.success("Member removed successfully");
      setRemoveDialogOpen(false);
      setRemoveMemberData(null);
      await getMembers(orgId);
    } catch (err: unknown) {
      console.error("Failed to remove member:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to remove member"
      );
    } finally {
      setRemoving(false);
    }
  };

  const getRoleIcon = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return <Crown className="w-3.5 h-3.5" />;
      case "admin":
        return <Shield className="w-3.5 h-3.5" />;
      case "member":
        return <User className="w-3.5 h-3.5" />;
      case "viewer":
        return <Eye className="w-3.5 h-3.5" />;
      default:
        return <User className="w-3.5 h-3.5" />;
    }
  };

  const getRoleBadgeColor = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return "bg-primary/10 text-primary";
      case "admin":
        return "bg-blue-500/10 text-blue-500";
      case "member":
        return "bg-muted text-muted-foreground";
      case "viewer":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const isOwner = organization?.owner_id === user?.id;
  const canManageMembers = isOwner;

  const getRelativeTime = (dateString: string | null) => {
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
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading members...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Team Members</h1>
          <p className="text-xs text-muted-foreground">{organization?.name}</p>
        </div>
        {canManageMembers && (
          <Button
            onClick={() => setInviteDialogOpen(true)}
            className="bg-primary text-primary-foreground"
            size="sm"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {members.length === 0 ? (
          <div className="text-center py-12">
            <Mail className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">No members yet</p>
            {canManageMembers && (
              <Button
                onClick={() => setInviteDialogOpen(true)}
                className="bg-primary text-primary-foreground"
                size="sm"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Invite First Member
              </Button>
            )}
          </div>
        ) : (
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
                <tr
                  key={member.id}
                  className="hover:bg-muted/50 transition-colors"
                >
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
                    <Badge
                      className={`${getRoleBadgeColor(member.role)} flex items-center gap-1 w-fit text-xs`}
                    >
                      {getRoleIcon(member.role)}
                      {member.role}
                    </Badge>
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
                            onClick={() => handleEditRole(member)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveClick(member)}
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
        )}
      </div>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join this organization
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="member@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-background border-border mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as MemberRole)}
              >
                <SelectTrigger className="bg-background border-border mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="admin">
                    Admin - Full management access
                  </SelectItem>
                  <SelectItem value="member">
                    Member - Can edit and collaborate
                  </SelectItem>
                  <SelectItem value="viewer">
                    Viewer - View-only access
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteDialogOpen(false)}
              className="border-border"
              disabled={inviting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail || inviting}
              className="bg-primary text-primary-foreground"
            >
              {inviting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>Change Member Role</DialogTitle>
            <DialogDescription>
              Update the role for {editMember?.name || editMember?.email}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={editRole}
              onValueChange={(value) => setEditRole(value as MemberRole)}
            >
              <SelectTrigger className="bg-background border-border mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border">
                <SelectItem value="admin">
                  Admin - Full management access
                </SelectItem>
                <SelectItem value="member">
                  Member - Can edit and collaborate
                </SelectItem>
                <SelectItem value="viewer">
                  Viewer - View-only access
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              className="border-border"
              disabled={updating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateRole}
              disabled={updating}
              className="bg-primary text-primary-foreground"
            >
              {updating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Role"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to remove{" "}
              {removeMemberData?.name || removeMemberData?.email} from this
              organization? They will lose access to all organization resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border" disabled={removing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removing}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {removing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Removing...
                </>
              ) : (
                "Remove Member"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
