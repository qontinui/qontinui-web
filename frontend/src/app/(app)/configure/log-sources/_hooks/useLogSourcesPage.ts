import { useState, useCallback } from "react";
import {
  useRunnerHealth,
  useGlobalLogSourceSettings,
  runnerApi,
  type GlobalLogSource,
  type GlobalLogSourceProfile,
  type GlobalLogSourceSettings,
  type LogSourceAiSelectionMode,
} from "@/lib/runner-api";
import { generateId } from "../log-sources-utils";
import type {
  ExpandedSections,
  SaveMessage,
  UseLogSourcesPageReturn,
} from "../log-sources-types";

export function useLogSourcesPage(): UseLogSourcesPageReturn {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const {
    data: loadedSettings,
    isLoading: settingsLoading,
    error: settingsError,
    refetch,
  } = useGlobalLogSourceSettings();

  // Local state for editing
  const [settings, setSettings] = useState<GlobalLogSourceSettings | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // UI state
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    aiSettings: true,
    sources: true,
    profiles: true,
  });
  const [editingSource, setEditingSource] = useState<GlobalLogSource | null>(
    null
  );
  const [editingProfile, setEditingProfile] =
    useState<GlobalLogSourceProfile | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState<SaveMessage>(null);

  // Sync loaded data to local state
  const current = settings ?? loadedSettings;

  const updateSettings = useCallback(
    (updater: (prev: GlobalLogSourceSettings) => GlobalLogSourceSettings) => {
      setSettings((prev) => {
        const base = prev ?? loadedSettings;
        if (!base) return prev;
        return updater(base);
      });
      setDirty(true);
    },
    [loadedSettings]
  );

  const handleSave = async () => {
    if (!current) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await runnerApi.saveGlobalLogSourceSettings(current);
      setDirty(false);
      setSaveMessage({ type: "success", text: "Settings saved" });
      refetch();
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleMigrate = async () => {
    try {
      const result = await runnerApi.migrateLogSources();
      setSaveMessage({
        type: "success",
        text: `Migrated ${result.migrated} log sources`,
      });
      refetch();
      setSettings(null);
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Migration failed",
      });
    }
  };

  const handleRefresh = () => {
    refetch();
    setSettings(null);
    setDirty(false);
  };

  const toggleSection = (section: keyof ExpandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Source operations
  const addSource = (source: Omit<GlobalLogSource, "id">) => {
    updateSettings((prev) => ({
      ...prev,
      sources: [...prev.sources, { ...source, id: generateId("source") }],
    }));
    setShowAddSource(false);
  };

  const updateSource = (source: GlobalLogSource) => {
    updateSettings((prev) => ({
      ...prev,
      sources: prev.sources.map((s) => (s.id === source.id ? source : s)),
    }));
    setEditingSource(null);
  };

  const deleteSource = (id: string) => {
    updateSettings((prev) => ({
      ...prev,
      sources: prev.sources.filter((s) => s.id !== id),
      profiles: prev.profiles.map((p) => ({
        ...p,
        source_ids: p.source_ids.filter((sid) => sid !== id),
      })),
    }));
  };

  const toggleSourceEnabled = (id: string) => {
    updateSettings((prev) => ({
      ...prev,
      sources: prev.sources.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    }));
  };

  // Profile operations
  const addProfile = (
    profile: Omit<GlobalLogSourceProfile, "id" | "created_at" | "updated_at">
  ) => {
    const now = new Date().toISOString();
    const newProfile: GlobalLogSourceProfile = {
      ...profile,
      id: generateId("profile"),
      created_at: now,
      updated_at: now,
    };
    updateSettings((prev) => ({
      ...prev,
      profiles: [...prev.profiles, newProfile],
      default_profile_id: prev.default_profile_id || newProfile.id,
    }));
    setShowAddProfile(false);
  };

  const updateProfile = (profile: GlobalLogSourceProfile) => {
    updateSettings((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) =>
        p.id === profile.id
          ? { ...profile, updated_at: new Date().toISOString() }
          : p
      ),
    }));
    setEditingProfile(null);
  };

  const deleteProfile = (id: string) => {
    updateSettings((prev) => ({
      ...prev,
      profiles: prev.profiles.filter((p) => p.id !== id),
      default_profile_id:
        prev.default_profile_id === id ? undefined : prev.default_profile_id,
    }));
  };

  const setDefaultProfile = (id: string) => {
    updateSettings((prev) => ({ ...prev, default_profile_id: id }));
  };

  const setAiSelectionMode = (mode: LogSourceAiSelectionMode) => {
    updateSettings((prev) => ({ ...prev, ai_selection_mode: mode }));
  };

  return {
    // Data
    current: current ?? null,
    isLoading: healthLoading || settingsLoading,
    isOffline,
    settingsError,

    // State
    saving,
    dirty,
    expandedSections,
    editingSource,
    editingProfile,
    showAddSource,
    showAddProfile,
    saveMessage,

    // Actions
    handleSave,
    handleMigrate,
    handleRefresh,
    toggleSection,
    setAiSelectionMode,

    // Source operations
    addSource,
    updateSource,
    deleteSource,
    toggleSourceEnabled,
    setEditingSource,
    setShowAddSource,

    // Profile operations
    addProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
    setEditingProfile,
    setShowAddProfile,
  };
}
