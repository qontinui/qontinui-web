import type {
  GlobalLogSource,
  GlobalLogSourceProfile,
  GlobalLogSourceSettings,
  LogSourceAiSelectionMode,
} from "@/lib/runner-api";

export type ExpandedSections = {
  aiSettings: boolean;
  sources: boolean;
  profiles: boolean;
};

export type SaveMessage = {
  type: "success" | "error";
  text: string;
} | null;

export interface SourceEditorProps {
  source: GlobalLogSource | null;
  onSave: (source: GlobalLogSource | Omit<GlobalLogSource, "id">) => void;
  onCancel: () => void;
}

export interface ProfileEditorProps {
  profile: GlobalLogSourceProfile | null;
  sources: GlobalLogSource[];
  onSave: (
    profile:
      | GlobalLogSourceProfile
      | Omit<GlobalLogSourceProfile, "id" | "created_at" | "updated_at">
  ) => void;
  onCancel: () => void;
}

export interface UseLogSourcesPageReturn {
  // Data
  current: GlobalLogSourceSettings | null;
  isLoading: boolean;
  isOffline: boolean;
  settingsError: string | null;

  // State
  saving: boolean;
  dirty: boolean;
  expandedSections: ExpandedSections;
  editingSource: GlobalLogSource | null;
  editingProfile: GlobalLogSourceProfile | null;
  showAddSource: boolean;
  showAddProfile: boolean;
  saveMessage: SaveMessage;

  // Actions
  handleSave: () => Promise<void>;
  handleMigrate: () => Promise<void>;
  handleRefresh: () => void;
  toggleSection: (section: keyof ExpandedSections) => void;
  setAiSelectionMode: (mode: LogSourceAiSelectionMode) => void;

  // Source operations
  addSource: (source: Omit<GlobalLogSource, "id">) => void;
  updateSource: (source: GlobalLogSource) => void;
  deleteSource: (id: string) => void;
  toggleSourceEnabled: (id: string) => void;
  setEditingSource: (source: GlobalLogSource | null) => void;
  setShowAddSource: (show: boolean) => void;

  // Profile operations
  addProfile: (
    profile: Omit<GlobalLogSourceProfile, "id" | "created_at" | "updated_at">
  ) => void;
  updateProfile: (profile: GlobalLogSourceProfile) => void;
  deleteProfile: (id: string) => void;
  setDefaultProfile: (id: string) => void;
  setEditingProfile: (profile: GlobalLogSourceProfile | null) => void;
  setShowAddProfile: (show: boolean) => void;
}
