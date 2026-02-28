"use client";

import { useState, useCallback } from "react";
import {
  useRunnerHealth,
  useGlobalLogSourceSettings,
  runnerApi,
  type GlobalLogSource,
  type GlobalLogSourceProfile,
  type GlobalLogSourceSettings,
  type LogSourceAiSelectionMode,
  type LogSourceCategory,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  FileText,
  Plus,
  Trash2,
  Save,
  X,
  FolderOpen,
  RefreshCw,
  Copy,
  Check,
  Edit2,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";

const CATEGORIES: { value: LogSourceCategory; label: string; color: string }[] =
  [
    { value: "frontend", label: "Frontend", color: "#3b82f6" },
    { value: "backend", label: "Backend", color: "#22c55e" },
    { value: "api", label: "API", color: "#06b6d4" },
    { value: "mobile", label: "Mobile", color: "#f97316" },
    { value: "database", label: "Database", color: "#8b5cf6" },
    { value: "build", label: "Build", color: "#eab308" },
    { value: "testing", label: "Testing", color: "#ec4899" },
    { value: "runner", label: "Runner", color: "#f97316" },
    { value: "general", label: "General", color: "#6b7280" },
  ];

function getCategoryColor(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.color || "#6b7280";
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function LogSourcesPage() {
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
  const [expandedSections, setExpandedSections] = useState({
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
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  const toggleSection = (section: keyof typeof expandedSections) => {
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

  if (healthLoading || settingsLoading) {
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
            onClick={() => {
              refetch();
              setSettings(null);
              setDirty(false);
            }}
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

// ============================================================================
// Source Editor Modal
// ============================================================================

function SourceEditor({
  source,
  onSave,
  onCancel,
}: {
  source: GlobalLogSource | null;
  onSave: (source: GlobalLogSource | Omit<GlobalLogSource, "id">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: source?.name || "",
    description: source?.description || "",
    category: source?.category || ("general" as LogSourceCategory),
    type: source?.type || "file",
    path: source?.path || "",
    pattern: source?.pattern || "",
    tail_lines: source?.tail_lines || 100,
    color: source?.color || "",
    keywords: source?.keywords?.join(", ") || "",
    format: source?.format || "plaintext",
    parser: source?.parser || "generic",
    timestamp_pattern: source?.timestamp_pattern || "",
    timezone: source?.timezone || "local",
    error_patterns: source?.error_patterns?.join("\n") || "",
    warning_patterns: source?.warning_patterns?.join("\n") || "",
    ignore_patterns: source?.ignore_patterns?.join("\n") || "",
    poll_interval_ms: source?.poll_interval_ms || 5000,
  });
  const [showErrorMonitoring, setShowErrorMonitoring] = useState(false);

  const handleSubmit = () => {
    if (!form.name || !form.path) return;

    const baseData = {
      name: form.name,
      description: form.description,
      category: form.category as LogSourceCategory,
      type: form.type,
      path: form.path,
      pattern: form.pattern || undefined,
      tail_lines: form.tail_lines,
      enabled: source?.enabled ?? true,
      color: form.color || undefined,
      keywords: form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      format: form.format,
      parser: form.parser,
      timestamp_pattern: form.timestamp_pattern || undefined,
      timezone: form.timezone,
      error_patterns: form.error_patterns
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      warning_patterns: form.warning_patterns
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      ignore_patterns: form.ignore_patterns
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      poll_interval_ms: form.poll_interval_ms,
    };

    if (source) {
      onSave({ ...baseData, id: source.id } as GlobalLogSource);
    } else {
      onSave(baseData as Omit<GlobalLogSource, "id">);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-muted rounded-lg shadow-xl w-full max-w-md p-4 space-y-4 max-h-[85vh] overflow-y-auto border border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-white">
            {source ? "Edit Source" : "Add Source"}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-background rounded text-muted-foreground hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Backend Logs"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="FastAPI backend server logs"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value as LogSourceCategory,
                  }))
                }
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Type
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value }))
                }
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
              >
                <option value="file">File</option>
                <option value="directory">Directory</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Path *
            </label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={form.path}
                onChange={(e) =>
                  setForm((f) => ({ ...f, path: e.target.value }))
                }
                placeholder="/path/to/logs/app.log"
                className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
              />
              <button className="p-2 bg-background border border-border hover:bg-background/80 rounded-md text-muted-foreground">
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>

          {form.type === "directory" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Pattern
              </label>
              <input
                type="text"
                value={form.pattern}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pattern: e.target.value }))
                }
                placeholder="*.log"
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Tail Lines
              </label>
              <input
                type="number"
                value={form.tail_lines}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    tail_lines: parseInt(e.target.value) || 100,
                  }))
                }
                min={10}
                max={10000}
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Color
              </label>
              <input
                type="text"
                value={form.color}
                onChange={(e) =>
                  setForm((f) => ({ ...f, color: e.target.value }))
                }
                placeholder="#22c55e"
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Keywords (comma-separated)
            </label>
            <input
              type="text"
              value={form.keywords}
              onChange={(e) =>
                setForm((f) => ({ ...f, keywords: e.target.value }))
              }
              placeholder="python, fastapi, http, api"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Keywords help AI identify when this source is relevant
            </p>
          </div>

          {/* Error Monitoring Section */}
          <div className="border-t border-border pt-3 mt-3">
            <button
              type="button"
              onClick={() => setShowErrorMonitoring(!showErrorMonitoring)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-white"
            >
              {showErrorMonitoring ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Error Monitoring
            </button>

            {showErrorMonitoring && (
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Format
                    </label>
                    <select
                      value={form.format}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, format: e.target.value }))
                      }
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
                    >
                      <option value="plaintext">Plaintext</option>
                      <option value="json">JSON</option>
                      <option value="jsonl">JSONL</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Parser
                    </label>
                    <select
                      value={form.parser}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, parser: e.target.value }))
                      }
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
                    >
                      <option value="generic">Generic</option>
                      <option value="python">Python</option>
                      <option value="javascript">JavaScript</option>
                      <option value="rust">Rust</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Timestamp Pattern
                  </label>
                  <input
                    type="text"
                    value={form.timestamp_pattern}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        timestamp_pattern: e.target.value,
                      }))
                    }
                    placeholder={
                      "e.g. ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}"
                    }
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Timezone
                    </label>
                    <input
                      type="text"
                      value={form.timezone}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, timezone: e.target.value }))
                      }
                      placeholder="local"
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Poll Interval (ms)
                    </label>
                    <input
                      type="number"
                      value={form.poll_interval_ms}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          poll_interval_ms: parseInt(e.target.value) || 5000,
                        }))
                      }
                      min={500}
                      max={60000}
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Error Patterns (one per line)
                  </label>
                  <textarea
                    value={form.error_patterns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        error_patterns: e.target.value,
                      }))
                    }
                    placeholder="Custom regex patterns to identify errors"
                    rows={3}
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 font-mono text-white placeholder:text-muted-foreground"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Warning Patterns (one per line)
                  </label>
                  <textarea
                    value={form.warning_patterns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        warning_patterns: e.target.value,
                      }))
                    }
                    placeholder="Custom regex patterns to identify warnings"
                    rows={2}
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 font-mono text-white placeholder:text-muted-foreground"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Ignore Patterns (one per line)
                  </label>
                  <textarea
                    value={form.ignore_patterns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        ignore_patterns: e.target.value,
                      }))
                    }
                    placeholder="Patterns to suppress false positives"
                    rows={2}
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 font-mono text-white placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-white hover:bg-background rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name || !form.path}
            className="px-3 py-1.5 text-sm bg-primary text-black font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {source ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Profile Editor Modal
// ============================================================================

function ProfileEditor({
  profile,
  sources,
  onSave,
  onCancel,
}: {
  profile: GlobalLogSourceProfile | null;
  sources: GlobalLogSource[];
  onSave: (
    profile:
      | GlobalLogSourceProfile
      | Omit<GlobalLogSourceProfile, "id" | "created_at" | "updated_at">
  ) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: profile?.name || "",
    description: profile?.description || "",
    source_ids: profile?.source_ids || ([] as string[]),
  });

  const toggleSource = (id: string) => {
    setForm((f) => ({
      ...f,
      source_ids: f.source_ids.includes(id)
        ? f.source_ids.filter((sid) => sid !== id)
        : [...f.source_ids, id],
    }));
  };

  const selectByCategory = (category: string) => {
    const categorySourceIds = sources
      .filter((s) => s.category === category)
      .map((s) => s.id);
    setForm((f) => ({
      ...f,
      source_ids: [...new Set([...f.source_ids, ...categorySourceIds])],
    }));
  };

  const handleSubmit = () => {
    if (!form.name) return;

    const data = {
      ...(profile ? { id: profile.id, created_at: profile.created_at } : {}),
      name: form.name,
      description: form.description || undefined,
      source_ids: form.source_ids,
    };

    onSave(data as GlobalLogSourceProfile);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-muted rounded-lg shadow-xl w-full max-w-md p-4 space-y-4 max-h-[80vh] overflow-y-auto border border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-white">
            {profile ? "Edit Profile" : "Add Profile"}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-background rounded text-muted-foreground hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Web Development"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Sources for web frontend and backend development"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                Sources
              </label>
              <div className="flex gap-1">
                {["frontend", "backend", "mobile"].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => selectByCategory(cat)}
                    className="px-1.5 py-0.5 text-[10px] bg-background hover:bg-background/80 rounded capitalize text-muted-foreground"
                  >
                    + {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {sources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-center gap-2 p-1.5 rounded hover:bg-background/30 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={form.source_ids.includes(source.id)}
                    onChange={() => toggleSource(source.id)}
                    className="w-4 h-4 accent-brand-primary"
                  />
                  <span className="text-sm text-white">{source.name}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">
                    ({source.category})
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-white hover:bg-background rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name}
            className="px-3 py-1.5 text-sm bg-primary text-black font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {profile ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
