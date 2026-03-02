"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, Loader2 } from "lucide-react";
import type { TeamMember } from "@/types/collaboration";
import { useMembersPage } from "./_hooks/useMembersPage";
import { MembersTable } from "./_components/MembersTable";
import { InviteDialog } from "./_components/InviteDialog";
import { EditRoleDialog } from "./_components/EditRoleDialog";
import { RemoveMemberDialog } from "./_components/RemoveMemberDialog";

export default function MembersPage() {
  const {
    user,
    authLoading,
    loading,
    organization,
    members,
    canManageMembers,
    handleInvite,
    handleUpdateRole,
    handleRemove,
  } = useMembersPage();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeMemberData, setRemoveMemberData] = useState<TeamMember | null>(
    null
  );

  const handleEditRole = (member: TeamMember) => {
    setEditMember(member);
    setEditDialogOpen(true);
  };

  const handleRemoveClick = (member: TeamMember) => {
    setRemoveMemberData(member);
    setRemoveDialogOpen(true);
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
        <MembersTable
          members={members}
          canManageMembers={canManageMembers}
          onInvite={() => setInviteDialogOpen(true)}
          onEditRole={handleEditRole}
          onRemove={handleRemoveClick}
        />
      </div>

      <InviteDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onInvite={handleInvite}
      />

      <EditRoleDialog
        member={editMember}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onUpdateRole={handleUpdateRole}
      />

      <RemoveMemberDialog
        member={removeMemberData}
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        onRemove={handleRemove}
      />
    </div>
  );
}
