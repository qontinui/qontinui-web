"use client";

import { Tags, Play, Loader2, FolderOpen } from "lucide-react";
import {
  EditorHeader,
  EditorSection,
} from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  STRATEGY_OPTIONS,
  type ExplorationForm,
  type SavedExplorationItem,
} from "../types";
import { useConfigLoader } from "../_hooks/useConfigLoader";
import { useExploration, useAiAdvisor } from "../_hooks/useExploration";

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

export function ExplorationEditor({
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
}: ExplorationEditorProps) {
  const configLoader = useConfigLoader();
  const exploration = useExploration(form);

  const updateField = <K extends keyof ExplorationForm>(
    field: K,
    value: ExplorationForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const aiAdvisor = useAiAdvisor(updateField);

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
              <label aria-label="Exploration option" htmlFor="key--opt-value-1"
                key={opt.value}
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  form.strategy === opt.value
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-border hover:border-border"
                }`}
              >
                <input id="key--opt-value-1"
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
                    value={configLoader.configPath}
                    onChange={(e) => configLoader.setConfigPath(e.target.value)}
                    placeholder="Path to GUI automation config..."
                    className="flex-1 bg-muted border-border h-8 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => configLoader.configPath && configLoader.loadConfigFile(configLoader.configPath)}
                    disabled={configLoader.loadingConfig || !configLoader.configPath.trim()}
                  >
                    {configLoader.loadingConfig ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="size-3.5" />
                    )}
                  </Button>
                </div>
                {configLoader.configError && (
                  <p className="text-[10px] text-red-400">{configLoader.configError}</p>
                )}
                {configLoader.availableStates.length > 0 && (
                  <p className="text-[10px] text-emerald-400">
                    {configLoader.availableStates.length} states, {configLoader.availableTransitions.length} transitions loaded
                  </p>
                )}
              </div>

              {/* Visual State Selection or Text Fallback */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Target States
                </Label>
                {configLoader.availableStates.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {configLoader.availableStates.map((state) => {
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
                {configLoader.availableTransitions.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {configLoader.availableTransitions.map((trans) => {
                      const selectedIds = form.target_transition_ids
                        ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
                        : [];
                      return (
                        <label aria-label="Transition option" htmlFor="key--trans-id-0"
                          key={trans.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                            selectedIds.includes(trans.id)
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : "border-border hover:border-border"
                          }`}
                        >
                          <input id="key--trans-id-0"
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
              onClick={exploration.handleExecute}
              disabled={exploration.executing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              size="sm"
            >
              {exploration.executing ? (
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
            {exploration.execResult && (
              <p className="text-xs text-emerald-400">{exploration.execResult}</p>
            )}
            {exploration.execError && (
              <p className="text-xs text-red-400">{exploration.execError}</p>
            )}
          </div>
        </EditorSection>

        {/* AI Advisor */}
        <AiGeneratorPanel
          title="AI Exploration Advisor"
          accentColor="emerald"
          placeholder="Describe what you want to explore..."
          generating={aiAdvisor.aiGenerating}
          error={aiAdvisor.aiError}
          onGenerate={aiAdvisor.handleAiGenerate}
          result={
            aiAdvisor.aiResult ? (
              <div className="space-y-2 text-xs">
                {typeof (aiAdvisor.aiResult.data as Record<string, unknown>)
                  ?.strategy === "string" && (
                  <div>
                    <span className="text-muted-foreground">Strategy: </span>
                    <span className="text-foreground">
                      {
                        (aiAdvisor.aiResult.data as Record<string, unknown>)
                          .strategy as string
                      }
                    </span>
                  </div>
                )}
              </div>
            ) : undefined
          }
          onAccept={aiAdvisor.handleAiAccept}
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
