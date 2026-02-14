"use client";

import { useState, useEffect } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type GeneralSettings,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Settings,
  FileText,
  Wrench,
  Layers,
  Info,
} from "lucide-react";
import { useMenuModeStore } from "@/stores/menu-mode";

export default function GeneralSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [autoLoadLastConfig, setAutoLoadLastConfig] = useState(false);
  const [includeSummaryStep, setIncludeSummaryStep] = useState(true);
  const menuMode = useMenuModeStore((s) => s.menuMode);
  const setMenuMode = useMenuModeStore((s) => s.setMenuMode);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadSettings();
  }, [isOffline]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await runnerApi.getGeneralSettings();
      setAutoLoadLastConfig(data.auto_load_last_config ?? false);
      setIncludeSummaryStep(data.include_summary_step_by_default ?? true);
    } catch {
      toast.error("Failed to load general settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await runnerApi.saveGeneralSettings({
        auto_load_last_config: autoLoadLastConfig,
        include_summary_step_by_default: includeSummaryStep,
        preflight_check_enabled: false,
        session_auto_fix_on_failure: false,
      } satisfies GeneralSettings);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSaving(false);
    }
  };

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Settings className="size-5" />
            General
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Application preferences and default behaviors
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          variant="brand-primary"
          size="sm"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save
        </Button>
      </div>

      {/* Application Section */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="size-4" />
            Application
          </CardTitle>
          <CardDescription>Startup and loading behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-load" className="text-sm text-text-primary">
                Auto-load Last Configuration
              </Label>
              <p className="text-xs text-text-muted">
                Automatically load the last used configuration when the runner
                starts
              </p>
            </div>
            <Switch
              id="auto-load"
              checked={autoLoadLastConfig}
              onCheckedChange={setAutoLoadLastConfig}
            />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted">
              When enabled, the runner will restore your previous GUI automation
              configuration on startup, saving you from manually loading it each
              time.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Builder Section */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="size-4" />
            Workflow Builder
          </CardTitle>
          <CardDescription>Default settings for new workflows</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label
                htmlFor="include-summary"
                className="text-sm text-text-primary"
              >
                Include AI Summary in New Workflows
              </Label>
              <p className="text-xs text-text-muted">
                Add a summary generation step to new workflows by default
              </p>
            </div>
            <Switch
              id="include-summary"
              checked={includeSummaryStep}
              onCheckedChange={setIncludeSummaryStep}
            />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted">
              AI summaries provide a concise overview of each workflow run,
              including key findings and outcomes. You can always toggle this
              per workflow.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Menu Mode Section */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="size-4" />
            Menu Mode
          </CardTitle>
          <CardDescription>
            Control how much of the navigation is visible
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMenuMode("simple")}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors ${
                menuMode === "simple"
                  ? "bg-brand-primary/10 border-brand-primary/30 text-brand-primary"
                  : "bg-surface-canvas/30 border-border-subtle/30 text-text-muted hover:text-text-primary hover:border-border-subtle/60"
              }`}
            >
              <Wrench className="size-6" />
              <span className="text-sm font-medium">Simple</span>
              <span className="text-[11px] text-center opacity-70">
                Essential navigation only — Dashboard, Workflows, Runs, Runners,
                Settings
              </span>
            </button>

            <button
              onClick={() => setMenuMode("advanced")}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors ${
                menuMode === "advanced"
                  ? "bg-brand-primary/10 border-brand-primary/30 text-brand-primary"
                  : "bg-surface-canvas/30 border-border-subtle/30 text-text-muted hover:text-text-primary hover:border-border-subtle/60"
              }`}
            >
              <Layers className="size-6" />
              <span className="text-sm font-medium">Advanced</span>
              <span className="text-[11px] text-center opacity-70">
                Full navigation with all tools, components, and configuration
                pages
              </span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
