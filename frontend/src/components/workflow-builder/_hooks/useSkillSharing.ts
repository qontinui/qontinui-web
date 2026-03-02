import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@/contexts/organization-context";
import { skillSharingService } from "@/services/service-factory";
import type { OrgSkill } from "@/services/skill-sharing-service";
import type { SkillSharingTab } from "../_components/skill-sharing/types";

export function useSkillSharing(isOpen: boolean) {
  const { currentOrganization } = useOrganization();
  const [tab, setTab] = useState<SkillSharingTab>("my-skills");
  const [mySkills, setMySkills] = useState<OrgSkill[]>([]);
  const [orgSkills, setOrgSkills] = useState<OrgSkill[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<OrgSkill[]>([]);
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] = useState("");
  const [marketplaceTotal, setMarketplaceTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchMySkills = useCallback(async () => {
    setLoading(true);
    try {
      const skills = await skillSharingService.listMySkills();
      setMySkills(skills);
    } catch (err) {
      console.error("[SkillSharing] Failed to load skills:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOrgSkills = useCallback(async () => {
    if (!currentOrganization) return;
    setLoading(true);
    try {
      const skills = await skillSharingService.listOrgSkills(
        currentOrganization.id
      );
      setOrgSkills(skills);
    } catch (err) {
      console.error("[SkillSharing] Failed to load org skills:", err);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization]);

  const fetchMarketplaceSkills = useCallback(
    async (search?: string, category?: string) => {
      setLoading(true);
      try {
        const data = await skillSharingService.listMarketplaceSkills({
          search: search || undefined,
          category: category || undefined,
          limit: 50,
        });
        setMarketplaceSkills(data.items ?? []);
        setMarketplaceTotal(data.pagination?.total ?? 0);
      } catch (err) {
        console.error("[SkillSharing] Failed to load marketplace:", err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refreshCurrentTab = useCallback(async () => {
    if (tab === "my-skills") {
      await fetchMySkills();
    } else if (tab === "org-skills") {
      await fetchOrgSkills();
    } else {
      await fetchMarketplaceSkills(marketplaceSearch, marketplaceCategory);
    }
  }, [
    tab,
    fetchMySkills,
    fetchOrgSkills,
    fetchMarketplaceSkills,
    marketplaceSearch,
    marketplaceCategory,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (tab === "my-skills") {
      fetchMySkills();
    } else if (tab === "org-skills") {
      fetchOrgSkills();
    } else {
      fetchMarketplaceSkills(marketplaceSearch, marketplaceCategory);
    }
  }, [
    isOpen,
    tab,
    fetchMySkills,
    fetchOrgSkills,
    fetchMarketplaceSkills,
    marketplaceSearch,
    marketplaceCategory,
  ]);

  const handleToggleShare = useCallback(
    async (skillId: string, currentlyShared: boolean) => {
      setTogglingId(skillId);
      try {
        await skillSharingService.shareSkill(skillId, !currentlyShared);
        await fetchMySkills();
      } catch (err) {
        console.error("[SkillSharing] Failed to toggle sharing:", err);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchMySkills]
  );

  const handleFork = useCallback(
    async (skillId: string) => {
      setActionInProgress(skillId);
      try {
        await skillSharingService.forkSkill(skillId);
        await refreshCurrentTab();
      } catch (err) {
        console.error("[SkillSharing] Failed to fork skill:", err);
      } finally {
        setActionInProgress(null);
      }
    },
    [refreshCurrentTab]
  );

  const handleApprove = useCallback(
    async (skillId: string, status: string) => {
      setActionInProgress(skillId);
      try {
        await skillSharingService.approveSkill(skillId, status);
        await fetchOrgSkills();
      } catch (err) {
        console.error("[SkillSharing] Failed to update approval:", err);
      } finally {
        setActionInProgress(null);
      }
    },
    [fetchOrgSkills]
  );

  return {
    currentOrganization,
    tab,
    setTab,
    mySkills,
    orgSkills,
    marketplaceSkills,
    marketplaceSearch,
    setMarketplaceSearch,
    marketplaceCategory,
    setMarketplaceCategory,
    marketplaceTotal,
    loading,
    togglingId,
    actionInProgress,
    handleToggleShare,
    handleFork,
    handleApprove,
  };
}
