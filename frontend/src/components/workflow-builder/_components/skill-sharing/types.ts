import type { OrgSkill } from "@/services/skill-sharing-service";

export type SkillSharingTab = "my-skills" | "org-skills" | "marketplace";

export interface SkillSharingPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface MySkillsListProps {
  skills: OrgSkill[];
  togglingId: string | null;
  actionInProgress: string | null;
  hasOrg: boolean;
  onToggleShare: (skillId: string, currentlyShared: boolean) => void;
  onFork: (skillId: string) => void;
}

export interface OrgSkillsListProps {
  skills: OrgSkill[];
  actionInProgress: string | null;
  onFork: (skillId: string) => void;
  onApprove: (skillId: string, status: string) => void;
}

export interface MarketplaceSkillsListProps {
  skills: OrgSkill[];
  total: number;
  search: string;
  category: string;
  actionInProgress: string | null;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onFork: (skillId: string) => void;
}

export interface SkillSharingTabsProps {
  tab: SkillSharingTab;
  onTabChange: (tab: SkillSharingTab) => void;
  hasOrganization: boolean;
}
