"use client";

import { useState, useEffect } from "react";
import { Compass, Tags, Play, Loader2, Workflow, FolderOpen } from "lucide-react";
import { BuilderLayout, type BuilderItem } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import { useLocalStorageCrud, type LocalStorageItem } from "@/hooks/useLocalStorageCrud";
import {
  EditorHeader,
  EditorSection,
} from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";

// =============================================================================
// Data Model
// =============================================================================

type ExplorationStrategy =
  | "exhaustive"
  | "smoke_test"
  | "regression"
  | "random_walk"
  | "targeted";

interface ExplorationConfig {
  strategy: ExplorationStrategy;
  max_states: number;
  max_duration_seconds: number;
  target_state_ids: string[];
  target_transition_ids: string[];
  capture_screenshots: boolean;
  capture_transition_screenshots: boolean;
  state_delay_ms: number;
  stop_on_first_failure: boolean;
}

interface SavedExplorationItem extends LocalStorageItem, BuilderItem {
  tags: string[];
  config: ExplorationConfig;
  run_count: number;
}

// =============================================================================
// Form State
// =============================================================================

interface ExplorationForm {
  name: string;
  description: string;
  tags: string[];
  strategy: ExplorationStrategy;
  max_states: number;
  max_duration_seconds: number;
  target_state_ids: string;
  target_transition_ids: string;
  capture_screenshots: boolean;
  capture_transition_screenshots: boolean;
  state_delay_ms: number;
  stop_on_first_failure: boolean;
}

function toForm(item: SavedExplorationItem): ExplorationForm {
  return {
    name: item.name,
    description: item.description || "",
    tags: item.tags || [],
    strategy: item.config.strategy,
    max_states: item.config.max_states,
    max_duration_seconds: item.config.max_duration_seconds,
    target_state_ids: item.config.target_state_ids.join(", "),
    target_transition_ids: item.config.target_transition_ids.join(", "),
    capture_screenshots: item.config.capture_screenshots,
    capture_transition_screenshots: item.config.capture_transition_screenshots,
    state_delay_ms: item.config.state_delay_ms,
    stop_on_first_failure: item.config.stop_on_first_failure,
  };
}

function defaultForm(): ExplorationForm {
  return {
    name: "",
    description: "",
    tags: [],
    strategy: "smoke_test",
    max_states: 0,
    max_duration_seconds: 300,
    target_state_ids: "",
    target_transition_ids: "",
    capture_screenshots: true,
    capture_transition_screenshots: false,
    state_delay_ms: 500,
    stop_on_first_failure: false,
  };
}

function toPayload(
  form: ExplorationForm
): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description || undefined,
    tags: form.tags,
    config: {
      strategy: form.strategy,
      max_states: form.max_states,
      max_duration_seconds: form.max_duration_seconds,
      target_state_ids: form.target_state_ids
        ? form.target_state_ids.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      target_transition_ids: form.target_transition_ids
        ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      capture_screenshots: form.capture_screenshots,
      capture_transition_screenshots: form.capture_transition_screenshots,
      state_delay_ms: form.state_delay_ms,
      stop_on_first_failure: form.stop_on_first_failure,
    },
    run_count: 0,
  };
}

const STRATEGY_OPTIONS: {
  value: ExplorationStrategy;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    value: "smoke_test",
    label: "Smoke Test",
    description: "Quick test of core paths",
    color: "text-yellow-400",
  },
  {
    value: "exhaustive",
    label: "Exhaustive",
    description: "Visit all states and transitions",
    color: "text-red-400",
  },
  {
    value: "regression",
    label: "Regression",
    description: "Focus on previously failing areas",
    color: "text-blue-400",
  },
  {
    value: "random_walk",
    label: "Random Walk",
    description: "Random exploration for edge cases",
    color: "text-purple-400",
  },
  {
    value: "targeted",
    label: "Targeted",
    description: "Focus on specific states/transitions",
    color: "text-emerald-400",
  },
];

// =============================================================================
// Main Component
// =============================================================================

export default function StateExplorerPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);

  const storage = useLocalStorageCrud<SavedExplorationItem>(
    "qontinui-state-explorer-configs"
  );

  const items: SavedExplorationItem[] = storage.data || [];

  const builder = useBuilderPage<SavedExplorationItem, ExplorationForm>({
    items,
    isLoading: storage.isLoading,
    error: storage.error,
    isOffline: false,
    toForm,
    defaultForm,
    toPayload,
    onCreate: async (data) => {
      const result = await storage.create(
        data as Omit<SavedExplorationItem, "id" | "created_at" | "updated_at">
      );
      return result;
    },
    onUpdate: async (id, data) => {
      const result = await storage.update(id, data as Partial<SavedExplorationItem>);
      return result;
    },
    onDelete: (id) => storage.delete(id),
    refetch: storage.refetch,
  });

  return (
    <>
    <BuilderLayout<SavedExplorationItem>
      title="State Explorer"
      icon={Compass}
      iconColor="text-emerald-400"
      accentColor="emerald"
      items={builder.items}
      isLoading={builder.isLoading}
      error={builder.error}
      isOffline={builder.isOffline}
      selectedItem={builder.selectedItem}
      onSelect={builder.onSelect}
      onNew={builder.onNew}
      onDelete={builder.onDelete}
      refetch={builder.refetch}
      pageDescription="Test a state machine config against the live application. Traverses states and transitions using different strategies, verifying that expected UI elements are present at each state via image recognition."
      emptyIcon={Compass}
      emptyTitle="No exploration configs yet"
      emptyDescription="Create state exploration configurations"
      itemLabel="exploration config"
      searchPlaceholder="Search explorations..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <ExplorationListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={(item) => {
        const exploration = item as SavedExplorationItem;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-emerald-400"
            title="Insert into Workflow"
            onClick={(e) => {
              e.stopPropagation();
              setAddToWorkflowStep({
                type: "command",
                name: `Explore: ${exploration.name}`,
                command: `# State exploration: ${exploration.name}\n# Strategy: ${exploration.config.strategy}`,
                test_type: "custom_command" as const,
              });
            }}
          >
            <Workflow className="size-3.5" />
          </Button>
        );
      }}
      renderEditor={(item) => (
        <ExplorationEditor
          item={item}
          form={builder.form}
          setForm={builder.setForm}
          isDirty={builder.isDirty}
          isNew={builder.isNew}
          isSaving={builder.isSaving}
          onSave={builder.save}
          onDelete={builder.deleteSelected}
        />
      )}
    />
    <AddToWorkflowDialog
      open={addToWorkflowStep !== null}
      onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
      stepData={addToWorkflowStep ?? {}}
    />
    </>
  );
}

// =============================================================================
// List Item
// =============================================================================

function ExplorationListItem({
  item,
  isSelected,
}: {
  item: SavedExplorationItem;
  isSelected: boolean;
}) {
  const strategyOpt = STRATEGY_OPTIONS.find(
    (s) => s.value === item.config.strategy
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Compass
          className={`size-4 shrink-0 ${isSelected ? "text-emerald-400" : "text-muted-foreground"}`}
        />
        <span
          className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}
        >
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        {strategyOpt && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          >
            {strategyOpt.label}
          </Badge>
        )}
        {item.run_count > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-muted text-muted-foreground"
          >
            {item.run_count} run{item.run_count !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">
          {item.description}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Editor
// =============================================================================

interface ExplorationEditorProps {
  item: SavedExplorationItem;
  form: ExplorationForm;
  setForm: (
    form: ExplorationForm | ((prev: ExplorationForm) => ExplorationForm)
  ) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
}

function ExplorationEditor({
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
}: ExplorationEditorProps) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // Config file browser state
  const [configPath, setConfigPath] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [availableStates, setAvailableStates] = useState<Array<{ id: string; name: string; description?: string; is_initial?: boolean; is_final?: boolean }>>([]);
  const [availableTransitions, setAvailableTransitions] = useState<Array<{ id: string; name: string; from_state: string; to_state: string }>>([]);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load states/transitions from a config file
  const loadConfigFile = async (path: string) => {
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const res = await fetch("http://localhost:9876/configs/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(`Failed to parse: ${res.statusText}`);
      const result = await res.json();
      const data = result.data ?? result;
      setAvailableStates(data.states ?? []);
      setAvailableTransitions(data.transitions ?? []);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
  };

  // Check runner for loaded config on mount
  useEffect(() => {
    const checkRunnerConfig = async () => {
      try {
        const res = await fetch("http://localhost:9876/status");
        if (res.ok) {
          const status = await res.json();
          const path = status.data?.config_path ?? status.config_path;
          if (path) {
            setConfigPath(path);
            await loadConfigFile(path);
          }
        }
      } catch {
        // Runner not available
      }
    };
    checkRunnerConfig();
  }, []);

  // Toggle helpers for visual selection
  const toggleTargetState = (stateId: string) => {
    const currentIds = form.target_state_ids
      ? form.target_state_ids.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const idx = currentIds.indexOf(stateId);
    if (idx >= 0) {
      currentIds.splice(idx, 1);
    } else {
      currentIds.push(stateId);
    }
    updateField("target_state_ids", currentIds.join(", "));
  };

  const toggleTargetTransition = (transId: string) => {
    const currentIds = form.target_transition_ids
      ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const idx = currentIds.indexOf(transId);
    if (idx >= 0) {
      currentIds.splice(idx, 1);
    } else {
      currentIds.push(transId);
    }
    updateField("target_transition_ids", currentIds.join(", "));
  };

  const updateField = <K extends keyof ExplorationForm>(
    field: K,
    value: ExplorationForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleExecute = async () => {
    setExecuting(true);
    setExecResult(null);
    setExecError(null);
    try {
      const res = await runnerApi.startExploration({
        config_path: "",
        strategy: form.strategy,
        max_states: form.max_states || undefined,
        max_duration_seconds: form.max_duration_seconds || undefined,
        target_state_ids: form.target_state_ids
          ? form.target_state_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        target_transition_ids: form.target_transition_ids
          ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        capture_screenshots: form.capture_screenshots,
        stop_on_first_failure: form.stop_on_first_failure,
      });
      setExecResult(`Exploration started: ${res.run_id}`);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  };

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await runnerApi.aiSuggestExplorationStrategy(prompt);
      setAiResult(res as Record<string, unknown>);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAccept = () => {
    if (!aiResult) return;
    const data =
      (aiResult.data as Record<string, unknown>) || aiResult;
    if (typeof data.strategy === "string") {
      updateField("strategy", data.strategy as ExplorationStrategy);
    }
    if (typeof data.max_states === "number") {
      updateField("max_states", data.max_states);
    }
    if (typeof data.max_duration_seconds === "number") {
      updateField("max_duration_seconds", data.max_duration_seconds);
    }
    setAiResult(null);
  };

  return (
    <div className="flex flex-col h-full">
      <EditorHeader
        name={form.name}
        onNameChange={(name) => updateField("name", name)}
        onSave={onSave}
        onDelete={onDelete}
        isSaving={isSaving}
        isDirty={isDirty}
        isNew={isNew}
        nameplaceholder="Exploration config name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <EditorSection title="Description" defaultOpen={true}>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe this exploration configuration..."
            rows={2}
            className="bg-muted border-border text-sm resize-none"
          />
        </EditorSection>

        {/* Exploration Strategy */}
        <EditorSection title="Exploration Strategy" defaultOpen={true}>
          <div className="space-y-2">
            {STRATEGY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  form.strategy === opt.value
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-border hover:border-border"
                }`}
              >
                <input
                  type="radio"
                  name="strategy"
                  value={opt.value}
                  checked={form.strategy === opt.value}
                  onChange={() => updateField("strategy", opt.value)}
                  className="mt-0.5 accent-emerald-500"
                />
                <div>
                  <div className={`text-sm font-medium ${opt.color}`}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {opt.description}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {form.strategy === "targeted" && (
            <div className="mt-3 space-y-3 pl-4 border-l-2 border-emerald-500/30">
              {/* Config File Browser */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Config File
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={configPath}
                    onChange={(e) => setConfigPath(e.target.value)}
                    placeholder="Path to GUI automation config..."
                    className="flex-1 bg-muted border-border h-8 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => configPath && loadConfigFile(configPath)}
                    disabled={loadingConfig || !configPath.trim()}
                  >
                    {loadingConfig ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="size-3.5" />
                    )}
                  </Button>
                </div>
                {configError && (
                  <p className="text-[10px] text-red-400">{configError}</p>
                )}
                {availableStates.length > 0 && (
                  <p className="text-[10px] text-emerald-400">
                    {availableStates.length} states, {availableTransitions.length} transitions loaded
                  </p>
                )}
              </div>

              {/* Visual State Selection or Text Fallback */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Target States
                </Label>
                {availableStates.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {availableStates.map((state) => {
                      const selectedIds = form.target_state_ids
                        ? form.target_state_ids.split(",").map((s) => s.trim()).filter(Boolean)
                        : [];
                      return (
                        <label
                          key={state.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                            selectedIds.includes(state.id)
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : "border-border hover:border-border"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(state.id)}
                            onChange={() => toggleTargetState(state.id)}
                            className="accent-emerald-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-foreground truncate">
                              {state.name}
                            </div>
                            {state.description && (
                              <div className="text-[10px] text-muted-foreground truncate">
                                {state.description}
                              </div>
                            )}
                          </div>
                          {state.is_initial && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">Initial</Badge>
                          )}
                          {state.is_final && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">Final</Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <Input
                    value={form.target_state_ids}
                    onChange={(e) => updateField("target_state_ids", e.target.value)}
                    placeholder="state-1, state-2"
                    className="bg-muted border-border h-8 text-sm"
                  />
                )}
              </div>

              {/* Visual Transition Selection or Text Fallback */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Target Transitions
                </Label>
                {availableTransitions.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {availableTransitions.map((trans) => {
                      const selectedIds = form.target_transition_ids
                        ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
                        : [];
                      return (
                        <label
                          key={trans.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                            selectedIds.includes(trans.id)
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : "border-border hover:border-border"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(trans.id)}
                            onChange={() => toggleTargetTransition(trans.id)}
                            className="accent-emerald-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-foreground truncate">
                              {trans.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {trans.from_state} → {trans.to_state}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <Input
                    value={form.target_transition_ids}
                    onChange={(e) => updateField("target_transition_ids", e.target.value)}
                    placeholder="trans-1, trans-2"
                    className="bg-muted border-border h-8 text-sm"
                  />
                )}
              </div>
            </div>
          )}
        </EditorSection>

        {/* Limits */}
        <EditorSection title="Limits" defaultOpen={true}>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max States</Label>
              <Input
                type="number"
                min={0}
                value={form.max_states}
                onChange={(e) =>
                  updateField("max_states", Number(e.target.value))
                }
                placeholder="0 = unlimited"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Max Duration (sec)
              </Label>
              <Input
                type="number"
                min={0}
                value={form.max_duration_seconds}
                onChange={(e) =>
                  updateField("max_duration_seconds", Number(e.target.value))
                }
                className="bg-muted border-border h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                State Delay (ms)
              </Label>
              <Input
                type="number"
                min={0}
                value={form.state_delay_ms}
                onChange={(e) =>
                  updateField("state_delay_ms", Number(e.target.value))
                }
                className="bg-muted border-border h-8 text-sm"
              />
            </div>
          </div>
        </EditorSection>

        {/* Options */}
        <EditorSection title="Options" defaultOpen={false}>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.capture_screenshots}
                onChange={(e) =>
                  updateField("capture_screenshots", e.target.checked)
                }
                className="accent-emerald-500"
              />
              <span className="text-sm text-muted-foreground">
                Capture screenshots
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.capture_transition_screenshots}
                onChange={(e) =>
                  updateField("capture_transition_screenshots", e.target.checked)
                }
                className="accent-emerald-500"
              />
              <span className="text-sm text-muted-foreground">
                Capture transition screenshots
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.stop_on_first_failure}
                onChange={(e) =>
                  updateField("stop_on_first_failure", e.target.checked)
                }
                className="accent-emerald-500"
              />
              <span className="text-sm text-muted-foreground">
                Stop on first failure
              </span>
            </label>
          </div>
        </EditorSection>

        {/* Tags */}
        <EditorSection title="Tags" icon={Tags} defaultOpen={false}>
          <TagInput
            tags={form.tags}
            onChange={(tags) => updateField("tags", tags)}
            placeholder="Add tag..."
          />
        </EditorSection>

        {/* Execution */}
        <EditorSection title="Execution" defaultOpen={false}>
          <div className="space-y-2">
            <Button
              onClick={handleExecute}
              disabled={executing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              size="sm"
            >
              {executing ? (
                <>
                  <Loader2 className="size-3 mr-1.5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="size-3 mr-1.5" />
                  Start Exploration
                </>
              )}
            </Button>
            {execResult && (
              <p className="text-xs text-emerald-400">{execResult}</p>
            )}
            {execError && (
              <p className="text-xs text-red-400">{execError}</p>
            )}
          </div>
        </EditorSection>

        {/* AI Advisor */}
        <AiGeneratorPanel
          title="AI Exploration Advisor"
          accentColor="emerald"
          placeholder="Describe what you want to explore..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
          result={
            aiResult ? (
              <div className="space-y-2 text-xs">
                {typeof (aiResult.data as Record<string, unknown>)
                  ?.strategy === "string" && (
                  <div>
                    <span className="text-muted-foreground">Strategy: </span>
                    <span className="text-foreground">
                      {
                        (aiResult.data as Record<string, unknown>)
                          .strategy as string
                      }
                    </span>
                  </div>
                )}
              </div>
            ) : undefined
          }
          onAccept={handleAiAccept}
          acceptLabel="Apply Strategy"
          templates={[
            {
              label: "Quick smoke test",
              prompt: "Suggest a quick smoke test strategy for core user flows",
            },
            {
              label: "Full coverage test",
              prompt:
                "Suggest an exhaustive strategy for maximum state coverage",
            },
            {
              label: "Regression focus",
              prompt:
                "Suggest a regression-focused strategy for previously failing areas",
            },
          ]}
        />
      </div>
    </div>
  );
}
