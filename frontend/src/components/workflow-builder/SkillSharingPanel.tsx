"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSkillSharing } from "./_hooks/useSkillSharing";
import { SkillSharingTabs } from "./_components/skill-sharing/SkillSharingTabs";
import { MySkillsList } from "./_components/skill-sharing/MySkillsList";
import { OrgSkillsList } from "./_components/skill-sharing/OrgSkillsList";
import { MarketplaceSkillsList } from "./_components/skill-sharing/MarketplaceSkillsList";
import type { SkillSharingPanelProps } from "./_components/skill-sharing/types";

export function SkillSharingPanel({ isOpen, onClose }: SkillSharingPanelProps) {
  const {
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
  } = useSkillSharing(isOpen);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Skill Sharing</DialogTitle>
          <p className="text-xs text-zinc-500 mt-0.5">
            Share skills with your organization
            {currentOrganization ? ` (${currentOrganization.name})` : ""}
          </p>
        </DialogHeader>

        <SkillSharingTabs
          tab={tab}
          onTabChange={setTab}
          hasOrganization={!!currentOrganization}
        />

        <ScrollArea className="max-h-[400px]">
          <div className="py-1">
            {loading ? (
              <p className="text-sm text-zinc-500 py-4 text-center">
                Loading...
              </p>
            ) : tab === "my-skills" ? (
              <MySkillsList
                skills={mySkills}
                togglingId={togglingId}
                actionInProgress={actionInProgress}
                hasOrg={!!currentOrganization}
                onToggleShare={handleToggleShare}
                onFork={handleFork}
              />
            ) : tab === "org-skills" ? (
              <OrgSkillsList
                skills={orgSkills}
                actionInProgress={actionInProgress}
                onFork={handleFork}
                onApprove={handleApprove}
              />
            ) : (
              <MarketplaceSkillsList
                skills={marketplaceSkills}
                total={marketplaceTotal}
                search={marketplaceSearch}
                category={marketplaceCategory}
                actionInProgress={actionInProgress}
                onSearchChange={setMarketplaceSearch}
                onCategoryChange={setMarketplaceCategory}
                onFork={handleFork}
              />
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
