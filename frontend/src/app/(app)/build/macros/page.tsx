"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { DeleteConfirmDialog } from "@/components/builders/DeleteConfirmDialog";
import { TagInput } from "@/components/builders/TagInput";
import {
  type Macro,
  type MacroStep,
  runnerApi,
  useMacrosDetailed,
} from "@/lib/runner-api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import {
  Zap,
  Trash2,
  Save,
  Copy,
  Play,
  Plus,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from "lucide-react";

const ACTION_TYPES = [
  "click",
  "double_click",
  "right_click",
  "type_text",
  "hotkey",
  "go_to_state",
  "wait",
  "screenshot",
] as const;

type ActionType = (typeof ACTION_TYPES)[number];

const ACTION_TYPE_COLORS: Record<string, string> = {
  click: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  double_click: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  right_click: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  type_text: "bg-green-500/20 text-green-300 border-green-500/30",
  hotkey: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  go_to_state: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  wait: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  screenshot: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
};

interface MacroForm {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  steps: MacroStep[];
}

const defaultForm: MacroForm = {
  id: "",
  name: "",
  description: "",
  category: "",
  tags: [],
  steps: [],
};

function macroToForm(macro: Macro): MacroForm {
  return {
    id: macro.id,
    name: macro.name,
    description: macro.description ?? "",
    category: macro.category ?? "",
    tags: macro.tags ?? [],
    steps: macro.steps ?? [],
  };
}

function createEmptyStep(actionType: ActionType): MacroStep {
  return {
    id: crypto.randomUUID(),
    action_type: actionType,
  };
}

function getStepLabel(step: MacroStep): string {
  if (step.name) return step.name;
  switch (step.action_type) {
    case "type_text":
      return step.text_input
        ? `Type: "${step.text_input.length > 30 ? step.text_input.slice(0, 30) + "..." : step.text_input}"`
        : "Type Text";
    case "hotkey":
      return step.hotkey ? `Hotkey: ${step.hotkey}` : "Hotkey";
    case "go_to_state":
      return step.target_state_names?.length
        ? `Go to: ${step.target_state_names[0]}`
        : "Go to State";
    case "wait":
      return step.pause_after_ms
        ? `Wait ${step.pause_after_ms}ms`
        : "Wait";
    default:
      return step.action_type.replace(/_/g, " ");
  }
}

function MacrosBuilderPageContent() {
  const searchParams = useSearchParams();
  const initialSelectedId = searchParams.get("id");
  const {
    data: macros,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useMacrosDetailed();
  const [selectedMacro, setSelectedMacro] = useState<Macro | null>(null);
  const [editForm, setEditForm] = useState<MacroForm>(defaultForm);
  const [singleDeleteOpen, setSingleDeleteOpen] = useState(false);

  useEffect(() => {
    if (selectedMacro) {
      setEditForm(macroToForm(selectedMacro));
    }
  }, [selectedMacro]);

  const handleSelect = useCallback((item: Macro | null) => {
    setSelectedMacro(item);
    if (!item) {
      setEditForm(defaultForm);
    }
  }, []);

  const handleNew = useCallback(() => {
    const newMacro: Macro = {
      id: `new-${Date.now()}`,
      name: "New Macro",
      steps: [],
    };
    setSelectedMacro(newMacro);
    setEditForm({
      ...defaultForm,
      id: newMacro.id,
      name: newMacro.name,
    });
  }, []);

  const isNew = selectedMacro?.id.startsWith("new-") ?? false;

  const handleSave = useCallback(async () => {
    try {
      const payload: Partial<Macro> = {
        name: editForm.name,
        description: editForm.description || undefined,
        category: editForm.category || undefined,
        tags: editForm.tags,
        steps: editForm.steps,
      };

      if (isNew) {
        const created = await runnerApi.createMacro(payload);
        await refetch();
        setSelectedMacro(created);
        toast.success("Macro created");
      } else if (selectedMacro) {
        const updated = await runnerApi.updateMacro(selectedMacro.id, payload);
        await refetch();
        setSelectedMacro(updated);
        toast.success("Macro updated");
      }
    } catch (err) {
      toast.error(
        `Failed to save macro: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [editForm, isNew, selectedMacro, refetch]);

  const handleDelete = useCallback(
    async (ids: string[]) => {
      try {
        for (const id of ids) {
          await runnerApi.deleteMacro(id);
        }
        await refetch();
        setSelectedMacro(null);
        setEditForm(defaultForm);
        toast.success(
          `Deleted ${ids.length} macro${ids.length !== 1 ? "s" : ""}`
        );
      } catch (err) {
        toast.error(
          `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [refetch]
  );

  const handleDuplicate = useCallback(async () => {
    if (!selectedMacro || isNew) return;
    try {
      const duplicated = await runnerApi.createMacro({
        name: `${selectedMacro.name} (copy)`,
        description: selectedMacro.description,
        category: selectedMacro.category,
        tags: selectedMacro.tags,
        steps: selectedMacro.steps.map((step) => ({
          ...step,
          id: crypto.randomUUID(),
        })),
      });
      await refetch();
      setSelectedMacro(duplicated);
      setEditForm(macroToForm(duplicated));
      toast.success("Macro duplicated");
    } catch (err) {
      toast.error(
        `Failed to duplicate: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [selectedMacro, isNew, refetch]);

  const handleRun = useCallback(async () => {
    if (!selectedMacro || isNew) return;
    try {
      await runnerApi.runMacro(selectedMacro.id);
      toast.success("Macro executed");
    } catch (err) {
      toast.error(
        `Failed to run: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [selectedMacro, isNew]);

  // Step management helpers
  const updateStep = useCallback(
    (stepIndex: number, updates: Partial<MacroStep>) => {
      setEditForm((f) => {
        const steps = [...f.steps];
        const existing = steps[stepIndex];
        if (!existing) return f;
        steps[stepIndex] = { ...existing, ...updates };
        return { ...f, steps };
      });
    },
    []
  );

  const addStep = useCallback((actionType: ActionType) => {
    setEditForm((f) => ({
      ...f,
      steps: [...f.steps, createEmptyStep(actionType)],
    }));
  }, []);

  const removeStep = useCallback((stepIndex: number) => {
    setEditForm((f) => ({
      ...f,
      steps: f.steps.filter((_, i) => i !== stepIndex),
    }));
  }, []);

  const moveStep = useCallback((stepIndex: number, direction: -1 | 1) => {
    setEditForm((f) => {
      const steps = [...f.steps];
      const targetIndex = stepIndex + direction;
      if (targetIndex < 0 || targetIndex >= steps.length) return f;
      const a = steps[stepIndex]!;
      const b = steps[targetIndex]!;
      steps[stepIndex] = b;
      steps[targetIndex] = a;
      return { ...f, steps };
    });
  }, []);

  const [addStepMenuOpen, setAddStepMenuOpen] = useState(false);

  // AI generation state
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);

  const macroTemplates = [
    { label: "Mouse click sequence", prompt: "Create a macro that performs a sequence of mouse clicks on UI elements" },
    { label: "Form fill automation", prompt: "Create a macro that fills in a form with text inputs and selections" },
    { label: "Keyboard shortcut sequence", prompt: "Create a macro that executes a series of keyboard shortcuts" },
    { label: "Screenshot workflow", prompt: "Create a macro that captures screenshots at different states" },
  ];

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const result = await runnerApi.aiGenerateMacro(prompt, editForm.category || undefined);
      if (result.success && result.data) {
        setAiResult(result.data);
      } else {
        setAiError(result.message ?? "Generation failed");
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAccept = () => {
    if (!aiResult) return;
    const data = aiResult as Record<string, unknown>;
    setEditForm((f) => ({
      ...f,
      name: (data.name as string) ?? f.name,
      description: (data.description as string) ?? f.description,
      category: (data.category as string) ?? f.category,
      tags: (data.tags as string[]) ?? f.tags,
      steps: Array.isArray(data.steps)
        ? (data.steps as Record<string, unknown>[]).map((s) => ({
            ...s,
            id: crypto.randomUUID(),
            action_type: (s.action_type as string) ?? "click",
          })) as MacroStep[]
        : f.steps,
    }));
    setAiResult(null);
    toast.success("AI-generated macro accepted");
  };

  return (
    <BuilderLayout<Macro>
      title="Macros"
      icon={Zap}
      iconColor="text-violet-400"
      accentColor="violet"
      items={macros ?? null}
      isLoading={isLoading}
      error={error}
      isOffline={isOffline}
      selectedItem={selectedMacro}
      onSelect={handleSelect}
      onNew={handleNew}
      onDelete={handleDelete}
      refetch={refetch}
      emptyIcon={Zap}
      emptyTitle="No macros yet"
      emptyDescription="Create macros to automate repetitive action sequences."
      itemLabel="macro"
      searchPlaceholder="Search macros..."
      initialSelectedId={initialSelectedId}
      renderListItem={(item) => (
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary truncate">
                {item.name}
              </span>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 shrink-0"
              >
                {item.steps?.length ?? 0} step
                {(item.steps?.length ?? 0) !== 1 ? "s" : ""}
              </Badge>
              {item.category && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 shrink-0 text-text-muted"
                >
                  {item.category}
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}
      renderEditor={() => (
        <div className="p-6">
          {/* Header with action buttons */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text-primary">
              {editForm.name || "Untitled"}
            </h2>
            <div className="flex items-center gap-2">
              {!isNew && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-muted"
                  onClick={handleDuplicate}
                >
                  <Copy className="size-4" />
                </Button>
              )}
              {!isNew && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400"
                  onClick={() => setSingleDeleteOpen(true)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
              {!isNew && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleRun}
                >
                  <Play className="size-3.5" /> Run
                </Button>
              )}
              <Button
                variant="brand-primary"
                size="sm"
                onClick={handleSave}
              >
                <Save className="size-4" /> Save
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <AiGeneratorPanel
              title="Generate Macro with AI"
              accentColor="amber"
              templates={macroTemplates}
              placeholder="Describe the macro you want to create..."
              generating={aiGenerating}
              error={aiError}
              onGenerate={handleAiGenerate}
              result={aiResult ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-text-primary">{aiResult.name as string ?? "Generated Macro"}</p>
                  {typeof aiResult.description === "string" && (
                    <p className="text-xs text-text-muted">{aiResult.description}</p>
                  )}
                  {Array.isArray(aiResult.steps) && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs text-text-muted">{(aiResult.steps as unknown[]).length} steps:</span>
                      {(aiResult.steps as Array<Record<string, unknown>>).map((step, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 border ${ACTION_TYPE_COLORS[step.action_type as string] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}
                        >
                          {(step.action_type as string ?? "").replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ) : undefined}
              onAccept={handleAiAccept}
              onRegenerate={() => setAiResult(null)}
              disclaimer="AI generates macro steps based on your description."
            />

            {/* Name */}
            <div>
              <Label className="text-xs text-text-muted">Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, name: e.target.value }))
                }
                className="mt-1 bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Description */}
            <div>
              <Label className="text-xs text-text-muted">Description</Label>
              <Textarea
                value={editForm.description}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    description: e.target.value,
                  }))
                }
                rows={2}
                className="mt-1 bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Category */}
            <div>
              <Label className="text-xs text-text-muted">Category</Label>
              <Input
                value={editForm.category}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, category: e.target.value }))
                }
                placeholder="e.g. navigation, data-entry, testing"
                className="mt-1 bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Tags */}
            <div>
              <Label className="text-xs text-text-muted">Tags</Label>
              <div className="mt-1">
                <TagInput
                  tags={editForm.tags}
                  onChange={(tags) => setEditForm((f) => ({ ...f, tags }))}
                />
              </div>
            </div>

            {/* Steps Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-text-muted">
                  Steps ({editForm.steps.length})
                </Label>
              </div>

              {editForm.steps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-subtle p-6 text-center">
                  <GripVertical className="size-8 mx-auto mb-2 text-text-muted opacity-40" />
                  <p className="text-sm text-text-muted">
                    No steps yet. Add a step to build your macro.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {editForm.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className="rounded-lg border border-border-subtle bg-surface-raised/30 p-3"
                    >
                      {/* Step header */}
                      <div className="flex items-center gap-2 mb-2">
                        <span data-content-role="metric" data-content-label="step index" className="text-xs text-text-muted font-mono w-5 shrink-0 text-center">
                          {index + 1}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 shrink-0 border ${ACTION_TYPE_COLORS[step.action_type] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30"}`}
                        >
                          {step.action_type}
                        </Badge>
                        <span data-content-role="label" data-content-label="step label" className="text-sm text-text-secondary truncate flex-1">
                          {getStepLabel(step)}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-text-muted"
                            onClick={() => moveStep(index, -1)}
                            disabled={index === 0}
                          >
                            <ArrowUp className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-text-muted"
                            onClick={() => moveStep(index, 1)}
                            disabled={index === editForm.steps.length - 1}
                          >
                            <ArrowDown className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-400"
                            onClick={() => removeStep(index)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Step inline editor */}
                      <div className="pl-7 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-text-muted">
                              Action Type
                            </Label>
                            <Select
                              value={step.action_type}
                              onValueChange={(v) =>
                                updateStep(index, { action_type: v })
                              }
                            >
                              <SelectTrigger className="mt-0.5 h-7 text-xs bg-surface-raised/50 border-border-subtle">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ACTION_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type.replace(/_/g, " ")}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[10px] text-text-muted">
                              Step Name
                            </Label>
                            <Input
                              value={step.name ?? ""}
                              onChange={(e) =>
                                updateStep(index, {
                                  name: e.target.value || undefined,
                                })
                              }
                              placeholder="Optional label"
                              className="mt-0.5 h-7 text-xs bg-surface-raised/50 border-border-subtle"
                            />
                          </div>
                        </div>

                        {/* Conditional fields based on action type */}
                        {step.action_type === "type_text" && (
                          <div>
                            <Label className="text-[10px] text-text-muted">
                              Text Input
                            </Label>
                            <Input
                              value={step.text_input ?? ""}
                              onChange={(e) =>
                                updateStep(index, {
                                  text_input: e.target.value || undefined,
                                })
                              }
                              placeholder="Text to type..."
                              className="mt-0.5 h-7 text-xs bg-surface-raised/50 border-border-subtle"
                            />
                          </div>
                        )}

                        {step.action_type === "hotkey" && (
                          <div>
                            <Label className="text-[10px] text-text-muted">
                              Hotkey
                            </Label>
                            <Input
                              value={step.hotkey ?? ""}
                              onChange={(e) =>
                                updateStep(index, {
                                  hotkey: e.target.value || undefined,
                                })
                              }
                              placeholder="e.g. ctrl+c, alt+tab"
                              className="mt-0.5 h-7 text-xs bg-surface-raised/50 border-border-subtle font-mono"
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-text-muted">
                              Pause After (ms)
                            </Label>
                            <Input
                              type="number"
                              value={step.pause_after_ms ?? ""}
                              onChange={(e) =>
                                updateStep(index, {
                                  pause_after_ms: e.target.value
                                    ? parseInt(e.target.value, 10)
                                    : undefined,
                                })
                              }
                              placeholder="0"
                              className="mt-0.5 h-7 text-xs bg-surface-raised/50 border-border-subtle"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-text-muted">
                              Timeout (seconds)
                            </Label>
                            <Input
                              type="number"
                              value={step.timeout_seconds ?? ""}
                              onChange={(e) =>
                                updateStep(index, {
                                  timeout_seconds: e.target.value
                                    ? parseInt(e.target.value, 10)
                                    : undefined,
                                })
                              }
                              placeholder="30"
                              className="mt-0.5 h-7 text-xs bg-surface-raised/50 border-border-subtle"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Step Button */}
              <div className="mt-3 relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 border-dashed"
                  onClick={() => setAddStepMenuOpen((v) => !v)}
                >
                  <Plus className="size-3.5" /> Add Step
                </Button>
                {addStepMenuOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-lg border border-border-subtle bg-surface-raised shadow-lg p-1">
                    {ACTION_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-canvas/60 rounded-md transition-colors flex items-center gap-2"
                        onClick={() => {
                          addStep(type);
                          setAddStepMenuOpen(false);
                        }}
                      >
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 border ${ACTION_TYPE_COLORS[type]}`}
                        >
                          {type.replace(/_/g, " ")}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DeleteConfirmDialog
            open={singleDeleteOpen}
            onOpenChange={setSingleDeleteOpen}
            onConfirm={() => {
              if (selectedMacro && !isNew) {
                handleDelete([selectedMacro.id]);
                setSingleDeleteOpen(false);
              }
            }}
            title="Delete Macro"
            itemNames={[editForm.name]}
          />
        </div>
      )}
    />
  );
}

export default function MacrosBuilderPage() {
  return (
    <Suspense>
      <MacrosBuilderPageContent />
    </Suspense>
  );
}
