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
  BookOpen,
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
import { runnerApi, useContextsDetailed, usePromptsDetailed } from "@/lib/runner-api";
import type { ContextItem } from "@/lib/runner-api";

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
  onWorkflowGenerated: (workflowId: string) => void;
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
  const [description, setDescription] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("generate-workflow-prompt") ?? "";
    }
    return "";
  });
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [inlineContext, setInlineContext] = useState("");
  const [filePath, setFilePath] = useState("");
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Context section
  const [showContext, setShowContext] = useState(false);

  // Saved prompts (generation category)
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const { data: savedPrompts } = usePromptsDetailed();
  const generationPrompts = useMemo(
    () => (savedPrompts || []).filter((p) => p.category === "Generation"),
    [savedPrompts]
  );

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

    return {
      description: description.trim(),
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
  ]);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await runnerApi.generateWorkflowAsync(
        buildGenerateRequest()
      );
      autoSaveGenerationPrompt(description); // fire-and-forget
      onNavigateToActiveRuns(response.task_run_id);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start workflow generation"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateAndRun = async () => {
    if (!description.trim()) return;
    setIsSubmitting(true);
    const toastId = toast.loading("Starting workflow generation...");
    try {
      const response = await runnerApi.generateWorkflowAsync(
        buildGenerateRequest()
      );
      autoSaveGenerationPrompt(description); // fire-and-forget
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
      setIsSubmitting(false);
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
          disabled={isCreatingManually || isSubmitting}
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
              {generationPrompts.length > 0 && (
                <Popover
                  open={showPromptPicker}
                  onOpenChange={setShowPromptPicker}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                    >
                      <BookOpen className="w-3 h-3 mr-1" />
                      Saved ({generationPrompts.length})
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="end">
                    <div className="max-h-[300px] overflow-y-auto">
                      {generationPrompts.map((prompt) => (
                        <button
                          key={prompt.id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border last:border-0"
                          onClick={() => {
                            setDescription(prompt.content);
                            setShowPromptPicker(false);
                          }}
                        >
                          <div className="font-medium text-xs truncate">
                            {prompt.name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {prompt.content.substring(0, 120)}
                            {prompt.content.length > 120 && "..."}
                          </div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <Textarea
              className="min-h-[120px] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder={`e.g., Run TypeScript type checking on the web frontend and fix any errors\ne.g., Check the runner API health, then verify UI Bridge elements are registered\ne.g., Run pytest with coverage and fix failing tests`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
          </div>

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
                  <Input
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="default"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Model</Label>
                  <Input
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="default"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    Fix Iterations (0 = skip)
                  </Label>
                  <Input
                    type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
                    placeholder="3"
                    value={maxFixIterations}
                    onChange={(e) => setMaxFixIterations(e.target.value)}
                  />
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
                  </label>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleGenerate}
              disabled={!description.trim() || isSubmitting}
              className="px-6"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {isSubmitting ? "Starting..." : "Generate"}
            </Button>
            <Button
              variant="outline"
              onClick={handleGenerateAndRun}
              disabled={!description.trim() || isSubmitting}
              className="px-6"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {isSubmitting ? "Starting..." : "Generate & Run"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
