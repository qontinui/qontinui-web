"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Plus,
  Play,
  Info,
  Layers,
  GitCompare,
  Globe,
  TestTube2,
  Activity,
  Monitor,
  Rocket,
  X,
  Save,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  runnerApi,
  useContextsDetailed,
  usePromptsDetailed,
  useAiSettings,
} from "@/lib/runner-api";
import type { ContextItem } from "@/lib/runner-api";
import { SpecSourceSection, type SpecSourceState } from "./SpecSourceSection";
import { buildSemanticSpecPrompt } from "@/lib/spec-prompt-builder";
import {
  GENERATION_TEMPLATES,
  type WorkflowGenerationTemplate,
} from "@/lib/workflow-generation-templates";

// Icon lookup map for template icons
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  GitCompare,
  Globe,
  TestTube2,
  Activity,
  Monitor,
  Rocket,
};

// Provider and model constants (shared with settings page)
const PROVIDERS = [
  { value: "claude_cli", label: "Claude CLI" },
  { value: "claude_api", label: "Claude API" },
  { value: "gemini_cli", label: "Gemini CLI" },
  { value: "gemini_api", label: "Gemini API" },
] as const;

const CLAUDE_MODELS = [
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
];

const GEMINI_MODELS = [
  { value: "gemini-3-flash", label: "Gemini 3 Flash" },
  { value: "gemini-3-pro", label: "Gemini 3 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

// =============================================================================
// Auto-run localStorage signal
// =============================================================================

export const AUTO_RUN_AFTER_GENERATE_KEY = "auto-run-after-generate";
export interface AutoRunAfterGenerate {
  taskRunId: string;
  timestamp: number;
}

// =============================================================================
// Types
// =============================================================================

export interface AiGeneratePanelProps {
  onCreateManually: () => void;
  isCreatingManually: boolean;
  onNavigateToActiveRuns: (taskRunId: string) => void;
}

// =============================================================================
// Auto-save generation prompts to prompt library
// =============================================================================

async function autoSaveGenerationPrompt(promptText: string): Promise<void> {
  try {
    const existing = await runnerApi.getPrompts();
    const trimmed = promptText.trim();
    const isDuplicate = existing.some(
      (p) => p.category === "Generation" && p.content.trim() === trimmed
    );
    if (isDuplicate) return;

    const name =
      trimmed.length > 60 ? trimmed.substring(0, 57) + "..." : trimmed;

    await runnerApi.createPrompt({
      name,
      content: trimmed,
      category: "Generation",
      description: "",
      tags: ["auto-saved"],
    });
  } catch {
    // Best-effort, don't block user flow
  }
}

// =============================================================================
// AiGeneratePanel Component
// =============================================================================

export function AiGeneratePanel({
  onCreateManually,
  isCreatingManually,
  onNavigateToActiveRuns,
}: AiGeneratePanelProps) {
  // Form state — description is persisted to localStorage
  const [description, setDescription] = useState("");
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [inlineContext, setInlineContext] = useState("");
  const [filePath, setFilePath] = useState("");
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<
    "generate" | "generate-and-run" | null
  >(null);

  // Hydrate description from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem("generate-workflow-prompt");
    if (saved) setDescription(saved);
  }, []);

  // Persist prompt to localStorage on change
  useEffect(() => {
    localStorage.setItem("generate-workflow-prompt", description);
  }, [description]);

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [maxIterations, setMaxIterations] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [maxFixIterations, setMaxFixIterations] = useState("");
  const [autoIncludeContexts, setAutoIncludeContexts] = useState(true);
  const [discoveryMode, setDiscoveryMode] = useState<
    "auto" | "enabled" | "disabled"
  >("auto");

  // Context section
  const [showContext, setShowContext] = useState(false);

  // Page Specs section
  const [specState, setSpecState] = useState<SpecSourceState>({
    discoveredSpecs: [],
    selectedGroupIds: new Set(),
  });
  const hasSpecs =
    specState.discoveredSpecs.length > 0 && specState.selectedGroupIds.size > 0;

  // Unified template picker (built-in + saved)
  const [showTemplates, setShowTemplates] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Saved prompts (generation category)
  const { data: savedPrompts, refetch: refetchPrompts } = usePromptsDetailed();
  const generationPrompts = useMemo(
    () => (savedPrompts || []).filter((p) => p.category === "Generation"),
    [savedPrompts]
  );

  // AI settings (for provider/model defaults)
  const { data: aiSettings } = useAiSettings();

  // Initialize provider/model from settings when loaded
  useEffect(() => {
    if (aiSettings && !provider) {
      setProvider(aiSettings.provider);
    }
  }, [aiSettings, provider]);

  useEffect(() => {
    if (aiSettings && !model) {
      // Get the configured model for the current provider
      const p = provider || aiSettings.provider;
      if (p === "claude_api") setModel(aiSettings.claude_api.model);
      else if (p === "gemini_cli") setModel(aiSettings.gemini_cli.model);
      else if (p === "gemini_api") setModel(aiSettings.gemini_api.model);
    }
  }, [aiSettings, model, provider]);

  // Models list changes based on selected provider
  const modelsForProvider = useMemo(() => {
    if (provider.startsWith("gemini")) return GEMINI_MODELS;
    return CLAUDE_MODELS;
  }, [provider]);

  // Saved contexts
  const { data: savedContexts, refetch: refetchContexts } =
    useContextsDetailed();

  // Refetch contexts on mount
  useEffect(() => {
    refetchContexts();
  }, [refetchContexts]);

  const handleContextToggle = useCallback((contextId: string) => {
    setSelectedContextIds((prev) =>
      prev.includes(contextId)
        ? prev.filter((id) => id !== contextId)
        : [...prev, contextId]
    );
  }, []);

  const handleApplyTemplate = useCallback(
    (template: WorkflowGenerationTemplate) => {
      setDescription(template.content);
      if (template.advancedDefaults) {
        const d = template.advancedDefaults;
        if (d.discoveryMode) setDiscoveryMode(d.discoveryMode);
        if (d.category) setCategory(d.category);
        if (d.tags) setTagsInput(d.tags);
        setShowAdvanced(true);
      }
      setShowTemplates(false);
    },
    []
  );

  const handleSaveAsTemplate = useCallback(async () => {
    const trimmed = description.trim();
    if (!trimmed) return;
    setIsSavingTemplate(true);
    try {
      const name =
        trimmed.length > 60 ? trimmed.substring(0, 57) + "..." : trimmed;
      await runnerApi.createPrompt({
        name,
        content: trimmed,
        category: "Generation",
        description: "",
        tags: ["user-template"],
      });
      refetchPrompts();
      toast.success("Template saved");
    } catch {
      toast.error("Failed to save template");
    } finally {
      setIsSavingTemplate(false);
    }
  }, [description, refetchPrompts]);

  const handleDeleteSavedTemplate = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await runnerApi.deletePrompt(id);
        refetchPrompts();
      } catch {
        toast.error("Failed to delete template");
      }
    },
    [refetchPrompts]
  );

  const handleImportFile = async () => {
    if (!filePath.trim()) return;
    setIsImportingFile(true);
    try {
      await runnerApi.createContextFromFile("user", {
        file_path: filePath.trim(),
      });
      setFilePath("");
      refetchContexts();
    } catch (err) {
      console.error("Failed to import context from file:", err);
    } finally {
      setIsImportingFile(false);
    }
  };

  const buildGenerateRequest = useCallback(() => {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Build combined description: spec prompt + user description
    let fullDescription = "";
    if (
      specState.discoveredSpecs.length > 0 &&
      specState.selectedGroupIds.size > 0
    ) {
      const specResult = buildSemanticSpecPrompt({
        discoveredSpecs: specState.discoveredSpecs,
        selectedGroupIds: specState.selectedGroupIds,
      });
      fullDescription = specResult.prompt;
      if (description.trim()) {
        fullDescription += `\n\n## Additional Instructions\n${description.trim()}`;
      }
      if (!tags.includes("spec-generated")) {
        tags.push("spec-generated");
      }
    } else {
      fullDescription = description.trim();
    }

    return {
      description: fullDescription,
      category: category.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      context_ids:
        selectedContextIds.length > 0 ? selectedContextIds : undefined,
      inline_context: inlineContext.trim() || undefined,
      max_iterations: maxIterations ? parseInt(maxIterations, 10) : undefined,
      provider: provider.trim() || undefined,
      model: model.trim() || undefined,
      max_fix_iterations: maxFixIterations
        ? parseInt(maxFixIterations, 10)
        : undefined,
      auto_include_contexts: autoIncludeContexts,
      discovery_mode: discoveryMode !== "auto" ? discoveryMode : undefined,
    };
  }, [
    description,
    tagsInput,
    category,
    selectedContextIds,
    inlineContext,
    maxIterations,
    provider,
    model,
    maxFixIterations,
    autoIncludeContexts,
    discoveryMode,
    specState,
  ]);

  const canGenerate = description.trim() || hasSpecs;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setSubmittingAction("generate");
    try {
      const response = await runnerApi.generateWorkflowAsync(
        buildGenerateRequest()
      );
      if (description.trim()) {
        autoSaveGenerationPrompt(description); // fire-and-forget
      }
      onNavigateToActiveRuns(response.task_run_id);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start workflow generation"
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleGenerateAndRun = async () => {
    if (!canGenerate) return;
    setSubmittingAction("generate-and-run");
    const toastId = toast.loading("Starting workflow generation...");
    try {
      const response = await runnerApi.generateWorkflowAsync(
        buildGenerateRequest()
      );
      if (description.trim()) {
        autoSaveGenerationPrompt(description); // fire-and-forget
      }
      localStorage.setItem(
        AUTO_RUN_AFTER_GENERATE_KEY,
        JSON.stringify({
          taskRunId: response.task_run_id,
          timestamp: Date.now(),
        } satisfies AutoRunAfterGenerate)
      );
      toast.dismiss(toastId);
      onNavigateToActiveRuns(response.task_run_id);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start workflow generation",
        { id: toastId }
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  // Group contexts by scope
  const contextsByScope = (savedContexts || []).reduce(
    (acc, ctx) => {
      const scope = ctx.scope || "user";
      if (!acc[scope]) acc[scope] = [];
      acc[scope].push(ctx);
      return acc;
    },
    {} as Record<string, ContextItem[]>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-zinc-200">
            Generate Workflow with AI
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-zinc-400"
          onClick={onCreateManually}
          disabled={isCreatingManually || submittingAction !== null}
        >
          {isCreatingManually ? (
            <Loader2 className="size-3 animate-spin mr-1" />
          ) : (
            <Plus className="size-3 mr-1" />
          )}
          Create Manually
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {/* Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-zinc-300">
                What should the workflow do?
              </Label>
              <Popover open={showTemplates} onOpenChange={setShowTemplates}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-xs">
                    <Layers className="w-3 h-3 mr-1" />
                    Templates
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="max-h-[400px] overflow-y-auto">
                    {/* Built-in templates */}
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900/50 border-b border-border">
                      Built-in
                    </div>
                    {GENERATION_TEMPLATES.map((template) => {
                      const IconComponent =
                        TEMPLATE_ICONS[template.icon] || Layers;
                      return (
                        <button
                          key={template.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0"
                          onClick={() => handleApplyTemplate(template)}
                        >
                          <div className="flex items-center gap-1.5 font-medium text-xs">
                            <IconComponent className="w-3 h-3 text-zinc-400 shrink-0" />
                            {template.name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {template.description}
                          </div>
                        </button>
                      );
                    })}

                    {/* Saved templates */}
                    {generationPrompts.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900/50 border-b border-border">
                          My Templates ({generationPrompts.length})
                        </div>
                        {generationPrompts.map((prompt) => (
                          <button
                            key={prompt.id}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0 group"
                            onClick={() => {
                              setDescription(prompt.content);
                              setShowTemplates(false);
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium text-xs truncate min-w-0">
                                {prompt.name}
                              </div>
                              <button
                                className="shrink-0 p-0.5 rounded hover:bg-destructive/20 text-zinc-500 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) =>
                                  handleDeleteSavedTemplate(prompt.id, e)
                                }
                                title="Delete template"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {prompt.content.substring(0, 120)}
                              {prompt.content.length > 120 && "..."}
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Save current as template */}
                    <div className="border-t border-border">
                      <button
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200"
                        disabled={!description.trim() || isSavingTemplate}
                        onClick={handleSaveAsTemplate}
                      >
                        {isSavingTemplate ? (
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        ) : (
                          <Save className="w-3 h-3 shrink-0" />
                        )}
                        Save Current as Template
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Textarea
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm min-h-[120px]"
              placeholder={
                hasSpecs
                  ? "Optional: add additional instructions for the AI..."
                  : "e.g., Run TypeScript type checking on the web frontend and fix any errors\ne.g., Check the runner API health, then verify UI Bridge elements are registered\ne.g., Run pytest with coverage and fix failing tests"
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
          </div>

          {/* Page Specs Section */}
          <SpecSourceSection onSpecsChanged={setSpecState} />

          {/* Context Section */}
          <Collapsible open={showContext} onOpenChange={setShowContext}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              {showContext ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <FileText className="w-4 h-4" />
              Attach Context
              {selectedContextIds.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-1">
                  {selectedContextIds.length}
                </Badge>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              <Tabs defaultValue="saved" className="w-full">
                <TabsList className="bg-zinc-800 border border-zinc-700">
                  <TabsTrigger value="saved" className="text-xs">
                    Saved Contexts
                  </TabsTrigger>
                  <TabsTrigger value="custom" className="text-xs">
                    Custom Text
                  </TabsTrigger>
                  <TabsTrigger value="file" className="text-xs">
                    Import File
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="saved" className="mt-2">
                  {!savedContexts || savedContexts.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-2">
                      No saved contexts. Create one in the Contexts tab or
                      import a file.
                    </p>
                  ) : (
                    <div className="max-h-[240px] overflow-y-auto space-y-1 pr-1">
                      {Object.entries(contextsByScope).map(
                        ([scope, contexts]) => (
                          <div key={scope}>
                            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                              {scope}
                            </p>
                            {contexts.map((ctx) => (
                              <label
                                key={ctx.id}
                                className="flex items-start gap-2 p-1.5 rounded hover:bg-zinc-800/50 cursor-pointer"
                              >
                                <Checkbox
                                  checked={selectedContextIds.includes(ctx.id)}
                                  onCheckedChange={() =>
                                    handleContextToggle(ctx.id)
                                  }
                                  className="mt-0.5"
                                />
                                <div className="min-w-0">
                                  <span className="text-sm text-zinc-300 block truncate">
                                    {ctx.name}
                                  </span>
                                  {ctx.category && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] mt-0.5"
                                    >
                                      {ctx.category}
                                    </Badge>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="custom" className="mt-2">
                  <Textarea
                    className="min-h-[100px] bg-zinc-800 border-zinc-700 text-zinc-200 text-xs font-mono"
                    placeholder="Paste additional context here (e.g., CLAUDE.md content, project notes, API docs)..."
                    value={inlineContext}
                    onChange={(e) => setInlineContext(e.target.value)}
                  />
                </TabsContent>

                <TabsContent value="file" className="mt-2 space-y-2">
                  <p className="text-xs text-zinc-500">
                    Import a file (e.g., CLAUDE.md, GEMINI.md) as a saved
                    context for reuse.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm flex-1"
                      placeholder="C:\path\to\CLAUDE.md"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                      disabled={isImportingFile}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleImportFile}
                      disabled={!filePath.trim() || isImportingFile}
                    >
                      {isImportingFile ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      Import
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CollapsibleContent>
          </Collapsible>

          {/* Advanced Options */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              {showAdvanced ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Advanced Options
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3 pl-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Category</Label>
                  <Input
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="e.g., testing, deployment"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    Tags (comma-separated)
                  </Label>
                  <Input
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="e.g., python, lint"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    Max Iterations
                  </Label>
                  <Input
                    type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="10"
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">AI Provider</Label>
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      setModel(""); // Reset model when provider changes
                    }}
                    className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm h-8 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Default (from Settings)</option>
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Model</Label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm h-8 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Default (from Settings)</option>
                    {modelsForProvider.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400 flex items-center gap-1">
                    Verification Rounds
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 text-zinc-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs p-3">
                          <p className="text-xs text-muted-foreground">
                            After generating, the AI reviews the workflow for
                            errors and fixes them. Each round is one
                            review-and-fix pass. Set to 0 to skip verification.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="3"
                    value={maxFixIterations}
                    onChange={(e) => setMaxFixIterations(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400 flex items-center gap-1">
                    Discovery
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 text-zinc-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-xs space-y-2 p-3"
                        >
                          <p className="font-medium text-xs">
                            Pre-generation system scan
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Gathers context about your system (project
                            structure, running apps, APIs, available tools) so
                            the AI generates steps with real paths and correct
                            configurations.
                          </p>
                          <div className="text-xs space-y-1 pt-1 border-t border-border">
                            <p>
                              <span className="text-zinc-300 font-medium">
                                Auto
                              </span>{" "}
                              — Only runs tools matching keywords in your
                              description
                            </p>
                            <p>
                              <span className="text-zinc-300 font-medium">
                                Enabled
                              </span>{" "}
                              — Runs all available tools (more thorough, slower)
                            </p>
                            <p>
                              <span className="text-zinc-300 font-medium">
                                Disabled
                              </span>{" "}
                              — Skips discovery entirely (fastest)
                            </p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <select
                    value={discoveryMode}
                    onChange={(e) =>
                      setDiscoveryMode(
                        e.target.value as "auto" | "enabled" | "disabled"
                      )
                    }
                    className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm h-8 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="auto">Auto</option>
                    <option value="enabled">Enabled (all tools)</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  <p className="text-[11px] text-zinc-500">
                    Scans your system for context before generating.
                  </p>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                    <Checkbox
                      checked={autoIncludeContexts}
                      onCheckedChange={(v) =>
                        setAutoIncludeContexts(v === true)
                      }
                    />
                    Auto-include contexts
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 text-zinc-500 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs p-3">
                          <p className="text-xs text-muted-foreground">
                            Automatically matches and includes relevant
                            knowledge base documents based on keywords in your
                            description.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </label>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      {/* Actions - fixed footer */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/50 px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate || submittingAction !== null}
            className="px-6"
          >
            {submittingAction === "generate" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {submittingAction === "generate" ? "Starting..." : "Generate"}
          </Button>
          <Button
            variant="outline"
            onClick={handleGenerateAndRun}
            disabled={!canGenerate || submittingAction !== null}
            className="px-6"
          >
            {submittingAction === "generate-and-run" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            {submittingAction === "generate-and-run"
              ? "Starting..."
              : "Generate & Run"}
          </Button>
        </div>
      </div>
    </div>
  );
}
