"use client";

import type { GlobalLogSource, GlobalLogSourceProfile } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  FileText,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Copy,
  Check,
  Edit2,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { getCategoryColor } from "./log-sources-utils";
import { useLogSourcesPage } from "./_hooks/useLogSourcesPage";
import { SourceEditor } from "./_components/SourceEditor";
import { ProfileEditor } from "./_components/ProfileEditor";

export default function LogSourcesPage() {
  const {
    current,
    isLoading,
    isOffline,
    settingsError,
    saving,
    dirty,
    expandedSections,
    editingSource,
    editingProfile,
    showAddSource,
    showAddProfile,
    saveMessage,
    handleSave,
    handleMigrate,
    handleRefresh,
    toggleSection,
    setAiSelectionMode,
    addSource,
    updateSource,
    deleteSource,
    toggleSourceEnabled,
    setEditingSource,
    setShowAddSource,
    addProfile,
    updateProfile,
    deleteProfile,
    setDefaultProfile,
    setEditingProfile,
    setShowAddProfile,
  } = useLogSourcesPage();

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-emerald-400" />
            <h1 className="text-lg font-semibold text-foreground">
              Log Sources
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
          <RunnerOfflineState message="Start the Qontinui Runner desktop app to configure log sources." />
        </main>
      </div>
    );
  }

  if (settingsError || !current) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-emerald-400" />
            <h1 className="text-lg font-semibold text-foreground">
              Log Sources
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
          <div className="text-center py-12 text-muted-foreground">
            Failed to load log source settings. Make sure the runner is running.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-semibold text-foreground">Log Sources</h1>
        </div>
        <div className="flex items-center gap-2">
          {saveMessage && (
            <span
              className={`text-xs px-2 py-1 rounded ${
                saveMessage.type === "success"
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {saveMessage.text}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMigrate}
            className="text-muted-foreground hover:text-white text-xs"
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Import from Projects
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="text-muted-foreground hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-primary hover:bg-primary/90 text-black font-semibold disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-4 w-full">
        <p className="text-sm text-muted-foreground">
          Configure global log sources shared across all projects. Use profiles
          to group sources for different workflows, or let AI automatically
          select relevant sources.
        </p>

        {/* AI Source Selection */}
        <div className="rounded-lg bg-muted/50 border border-border p-4">
          <button
            onClick={() => toggleSection("aiSettings")}
            className="flex items-center gap-2 w-full text-left"
          >
            {expandedSections.aiSettings ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">AI Source Selection</span>
          </button>

          {expandedSections.aiSettings && (
            <div className="mt-4 space-y-3 pl-6">
              <p className="text-xs text-muted-foreground">
                Let AI automatically select relevant log sources based on your
                task description.
              </p>
              <div className="flex flex-col gap-2">
                {(
                  [
                    {
                      value: "dynamic" as const,
                      label: "Dynamic",
                      desc: "Re-evaluate at each verification round",
                    },
                    {
                      value: "static" as const,
                      label: "Static",
                      desc: "Select once at workflow start",
                    },
                    {
                      value: "disabled" as const,
                      label: "Disabled",
                      desc: "Use profiles or all enabled sources",
                    },
                  ] as const
                ).map((mode) => (
                  <label
                    key={mode.value}
                    className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                      current.ai_selection_mode === mode.value
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted border border-transparent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="ai_mode"
                      checked={current.ai_selection_mode === mode.value}
                      onChange={() => setAiSelectionMode(mode.value)}
                      className="w-4 h-4 accent-brand-primary"
                    />
                    <div>
                      <div className="text-sm font-medium">{mode.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {mode.desc}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Log Sources Section */}
        <div className="rounded-lg bg-muted/50 border border-border p-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => toggleSection("sources")}
              className="flex items-center gap-2 text-left"
            >
              {expandedSections.sources ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">
                Log Sources ({current.sources.length})
              </span>
            </button>
            <button
              onClick={() => setShowAddSource(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Source
            </button>
          </div>

          {expandedSections.sources && (
            <div className="mt-4 space-y-2">
              {current.sources.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No log sources configured. Add sources or import from existing
                  projects.
                </p>
              ) : (
                current.sources.map((source) => (
                  <div
                    key={source.id}
                    className={`flex items-center gap-3 p-2 rounded-md ${
                      source.enabled
                        ? "bg-background/30"
                        : "bg-background/10 opacity-60"
                    }`}
                  >
                    <button
                      onClick={() => toggleSourceEnabled(source.id)}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                        source.enabled
                          ? "bg-primary border-primary"
                          : "border-text-muted"
                      }`}
                    >
                      {source.enabled && (
                        <Check className="w-3 h-3 text-black" />
                      )}
                    </button>
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          source.color || getCategoryColor(source.category),
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {source.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {source.path}
                      </div>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] bg-muted rounded capitalize text-muted-foreground flex-shrink-0">
                      {source.category}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setEditingSource(source)}
                        className="p-1 text-muted-foreground hover:text-white transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteSource(source.id)}
                        className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Profiles Section */}
        <div className="rounded-lg bg-muted/50 border border-border p-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => toggleSection("profiles")}
              className="flex items-center gap-2 text-left"
            >
              {expandedSections.profiles ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">
                Profiles ({current.profiles.length})
              </span>
            </button>
            <button
              onClick={() => setShowAddProfile(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Profile
            </button>
          </div>

          {expandedSections.profiles && (
            <div className="mt-4 space-y-2">
              {current.profiles.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No profiles configured. Profiles group log sources for
                  different workflows.
                </p>
              ) : (
                current.profiles.map((profile) => {
                  const isDefault = current.default_profile_id === profile.id;
                  const sourceCount = profile.source_ids.length;
                  const enabledCount = profile.source_ids.filter((id) =>
                    current.sources.find((s) => s.id === id && s.enabled)
                  ).length;

                  return (
                    <div
                      key={profile.id}
                      className="flex items-center gap-3 p-2 rounded-md bg-background/30"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {profile.name}
                          </span>
                          {isDefault && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-primary/20 text-primary rounded">
                              Default
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {enabledCount}/{sourceCount} sources enabled
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!isDefault && (
                          <button
                            onClick={() => setDefaultProfile(profile.id)}
                            className="px-2 py-1 text-xs text-muted-foreground hover:text-white transition-colors"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          onClick={() => setEditingProfile(profile)}
                          className="p-1 text-muted-foreground hover:text-white transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteProfile(profile.id)}
                          className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </main>

      {/* Source Editor Modal */}
      {(showAddSource || editingSource) && (
        <SourceEditor
          source={editingSource}
          onSave={(source) => {
            if (editingSource) {
              updateSource(source as GlobalLogSource);
            } else {
              addSource(source as Omit<GlobalLogSource, "id">);
            }
          }}
          onCancel={() => {
            setShowAddSource(false);
            setEditingSource(null);
          }}
        />
      )}

      {/* Profile Editor Modal */}
      {(showAddProfile || editingProfile) && (
        <ProfileEditor
          profile={editingProfile}
          sources={current.sources}
          onSave={(profile) => {
            if (editingProfile) {
              updateProfile(profile as GlobalLogSourceProfile);
            } else {
              addProfile(
                profile as Omit<
                  GlobalLogSourceProfile,
                  "id" | "created_at" | "updated_at"
                >
              );
            }
          }}
          onCancel={() => {
            setShowAddProfile(false);
            setEditingProfile(null);
          }}
        />
      )}
    </div>
  );
}
