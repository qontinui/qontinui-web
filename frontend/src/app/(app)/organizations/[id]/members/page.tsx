"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ArrowLeft,
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
  }, [orgId, user]);

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
      toast.error((err instanceof Error ? err.message : "Failed to send invitation"));
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
      toast.error((err instanceof Error ? err.message : "Failed to update member role"));
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
      toast.error((err instanceof Error ? err.message : "Failed to remove member"));
    } finally {
      setRemoving(false);
    }
  };

  const getRoleIcon = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return <Crown className="w-4 h-4" />;
      case "admin":
        return <Shield className="w-4 h-4" />;
      case "member":
        return <User className="w-4 h-4" />;
      case "viewer":
        return <Eye className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleBadgeColor = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return "bg-[#BD00FF]/20 text-[#BD00FF] border-[#BD00FF]/30";
      case "admin":
        return "bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30";
      case "member":
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      case "viewer":
        return "bg-gray-600/20 text-gray-500 border-gray-600/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const isOwner = organization?.owner_id === user?.id;
  const canManageMembers = isOwner; // Can be extended to include admins

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
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
            <p className="text-gray-400">Loading members...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.push(`/organizations/${orgId}`)}
            className="mb-4 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organization
          </Button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Team Members</h1>
              <p className="text-gray-400">{organization?.name}</p>
            </div>

            {canManageMembers && (
              <Button
                onClick={() => setInviteDialogOpen(true)}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Member
              </Button>
            )}
          </div>
        </div>

        {/* Members List */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Members ({members.length})</CardTitle>
            <CardDescription>
              Manage team members and their roles
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                <p className="text-gray-400 mb-4">No members yet</p>
                {canManageMembers && (
                  <Button
                    onClick={() => setInviteDialogOpen(true)}
                    className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Invite First Member
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-[#0A0A0B]/50 hover:bg-[#0A0A0B]/80 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 bg-gradient-to-br from-[#00D9FF] to-[#BD00FF] rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0">
                        {(member.name || member.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          {member.name || "Unknown User"}
                        </p>
                        <p className="text-sm text-gray-400 truncate">
                          {member.email}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Joined {getRelativeTime(member.joined_at)} • Last
                          active {getRelativeTime(member.last_active)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge
                        className={`${getRoleBadgeColor(member.role)} flex items-center gap-1`}
                      >
                        {getRoleIcon(member.role)}
                        {member.role}
                      </Badge>

                      {canManageMembers && member.role !== "owner" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditRole(member)}
                            className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRemoveClick(member)}
                            className="border-gray-700 hover:border-red-500 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invite Dialog */}
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogContent className="bg-[#1A1A1B] border-gray-800 text-white">
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
                  className="bg-[#0A0A0B] border-gray-800 text-white"
                />
              </div>

              <div>
                <Label htmlFor="role">Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(value) => setInviteRole(value as MemberRole)}
                >
                  <SelectTrigger className="bg-[#0A0A0B] border-gray-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1A1A1B] border-gray-800 text-white">
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
                className="border-gray-700"
                disabled={inviting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleInvite}
                disabled={!inviteEmail || inviting}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
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

        {/* Edit Role Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="bg-[#1A1A1B] border-gray-800 text-white">
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
                <SelectTrigger className="bg-[#0A0A0B] border-gray-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1A1A1B] border-gray-800 text-white">
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
                className="border-gray-700"
                disabled={updating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateRole}
                disabled={updating}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
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

        {/* Remove Member Dialog */}
        <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <AlertDialogContent className="bg-[#1A1A1B] border-gray-800 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                Are you sure you want to remove{" "}
                {removeMemberData?.name || removeMemberData?.email} from this
                organization? They will lose access to all organization
                resources.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="border-gray-700"
                disabled={removing}
              >
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
    </div>
  );
}
