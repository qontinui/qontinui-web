import { useCallback, useMemo, useState } from "react";
import { useOrganization } from "@/contexts/organization-context";
import { useAuth } from "@/contexts/auth-context";
import { createLogger } from "@/lib/logger";

const logger = createLogger("UnifiedSidebar");

export function useSidebarOrganizations() {
  const { user } = useAuth();
  const { currentOrganization, organizations, loading, switchOrganization } =
    useOrganization();
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);

  const handleOrganizationChange = useCallback(
    async (orgId: string) => {
      try {
        await switchOrganization(orgId);
      } catch (error) {
        logger.error("[UnifiedSidebar] Failed to switch organization:", error);
      }
    },
    [switchOrganization]
  );

  const handleCreateOrganization = useCallback(() => {
    setShowCreateOrgDialog(true);
  }, []);

  const switcherOrganizations = useMemo(
    () =>
      organizations.map((org) => ({
        id: org.id,
        name: org.name,
        avatar_url: undefined,
        member_count: org.member_count,
        role: (org.owner_id === user?.id ? "owner" : "member") as
          | "owner"
          | "admin"
          | "member"
          | "viewer",
      })),
    [organizations, user?.id]
  );

  const switcherCurrentOrg = useMemo(
    () =>
      currentOrganization
        ? {
            id: currentOrganization.id,
            name: currentOrganization.name,
            avatar_url: undefined,
            member_count: currentOrganization.member_count,
            role: (currentOrganization.owner_id === user?.id
              ? "owner"
              : "member") as "owner" | "admin" | "member" | "viewer",
          }
        : null,
    [currentOrganization, user?.id]
  );

  return {
    loading,
    showCreateOrgDialog,
    setShowCreateOrgDialog,
    switcherOrganizations,
    switcherCurrentOrg,
    handleOrganizationChange,
    handleCreateOrganization,
  };
}
