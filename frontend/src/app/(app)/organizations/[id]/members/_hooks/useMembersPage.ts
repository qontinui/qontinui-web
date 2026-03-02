"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { toast } from "sonner";
import type {
  Organization,
  TeamMember,
  MemberRole,
} from "@/types/collaboration";

export function useMembersPage() {
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

  const isOwner = organization?.owner_id === user?.id;
  const canManageMembers = isOwner;

  const handleInvite = useCallback(
    async (email: string, role: MemberRole) => {
      if (!email || !orgId) return;
      await inviteMember(orgId, email, role);
      toast.success(`Invitation sent to ${email}`);
      await getMembers(orgId);
    },
    [orgId, inviteMember, getMembers]
  );

  const handleUpdateRole = useCallback(
    async (member: TeamMember, newRole: MemberRole) => {
      if (!orgId) return;
      await updateMemberRole(orgId, member.user_id, newRole);
      toast.success("Member role updated successfully");
      await getMembers(orgId);
    },
    [orgId, updateMemberRole, getMembers]
  );

  const handleRemove = useCallback(
    async (member: TeamMember) => {
      if (!orgId) return;
      await removeMember(orgId, member.user_id);
      toast.success("Member removed successfully");
      await getMembers(orgId);
    },
    [orgId, removeMember, getMembers]
  );

  return {
    user,
    authLoading,
    loading,
    organization,
    members,
    canManageMembers,
    handleInvite,
    handleUpdateRole,
    handleRemove,
  };
}
