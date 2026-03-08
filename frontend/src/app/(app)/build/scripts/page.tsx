"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { TagInput } from "@/components/builders/TagInput";
import {
  type SavedPrompt,
  runnerApi,
  usePromptsDetailed,
} from "@/lib/runner-api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import Editor from "@monaco-editor/react";
import { FileCode, Code2, Save, Trash2, ChevronDown, Copy } from "lucide-react";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";

type EditForm = {
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  max_sessions: number | null;
  provider: string;
  model: string;
  requires_orchestrator: boolean;
  orchestrator_goal: string;
  orchestrator_max_iterations: number | null;
};

const defaultForm: EditForm = {
  name: "",
  description: "",
  content: "",
  category: "",
  tags: [],
  max_sessions: null,
  provider: "",
  model: "",
  requires_orchestrator: false,
  orchestrator_goal: "",
  orchestrator_max_iterations: null,
};

function promptToForm(p: SavedPrompt): EditForm {
  return {
    name: p.name,
    description: p.description ?? "",
    content: p.content,
    category: p.category ?? "",
    tags: p.tags ?? [],
    max_sessions: p.max_sessions ?? null,
    provider: p.provider ?? "",
    model: p.model ?? "",
    requires_orchestrator: p.requires_orchestrator ?? false,
    orchestrator_goal: p.orchestrator_goal ?? "",
    orchestrator_max_iterations: p.orchestrator_max_iterations ?? null,
  };
}

function ScriptsBuilderPageContent() {
  const searchParams = useSearchParams();
  const { data: prompts, isLoading, error, isOffline, refetch } =
    usePromptsDetailed();

  const [selectedScript, setSelectedScript] = useState<SavedPrompt | null>(
    null
  );
  const [editForm, setEditForm] = useState<EditForm>(defaultForm);
  const [orchestratorOpen, setOrchestratorOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [aiResult, setAiResult] = useState<Record<string, any> | null>(null);
  const [aiMode, setAiMode] = useState<"generate" | "improve">("generate");

  const initialId = searchParams.get("id");

  // Sync form when selection changes
  useEffect(() => {
    if (selectedScript) {
      setEditForm(promptToForm(selectedScript));
      if (selectedScript.requires_orchestrator) {
        setOrchestratorOpen(true);
      }
    }
  }, [selectedScript]);

  const handleSelect = useCallback((item: SavedPrompt | null) => {
    setSelectedScript(item);
    if (!item) {
      setEditForm(defaultForm);
      setOrchestratorOpen(false);
    }
  }, []);

  const handleNew = useCallback(() => {
    setSelectedScript({ id: "__new__", name: "", content: "" } as SavedPrompt);
    setEditForm({ ...defaultForm });
    setOrchestratorOpen(false);
  }, []);

  const handleSave = async () => {
    if (!editForm.name.trim()) {
      toast.error("Name is required");
      return;
    }

    const payload: Partial<SavedPrompt> = {
      name: editForm.name,
      description: editForm.description || undefined,
      content: editForm.content,
      category: editForm.category || undefined,
      tags: editForm.tags.length > 0 ? editForm.tags : undefined,
      max_sessions: editForm.max_sessions,
      provider: editForm.provider || undefined,
      model: editForm.model || undefined,
      requires_orchestrator: editForm.requires_orchestrator,
      orchestrator_goal: editForm.orchestrator_goal || undefined,
      orchestrator_max_iterations: editForm.orchestrator_max_iterations ?? undefined,
    };

    try {
      if (selectedScript && selectedScript.id !== "__new__") {
        const updated = await runnerApi.updatePrompt(
          selectedScript.id,
          payload
        );
        await refetch();
        setSelectedScript(updated);
        toast.success("Prompt updated");
      } else {
        const created = await runnerApi.createPrompt(payload);
        await refetch();
        setSelectedScript(created);
        toast.success("Prompt created");
      }
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleDelete = async (ids: string[]) => {
    try {
      for (const id of ids) {
        await runnerApi.deletePrompt(id);
      }
      await refetch();
      if (selectedScript && ids.includes(selectedScript.id)) {
        setSelectedScript(null);
        setEditForm(defaultForm);
      }
      toast.success(
        `Deleted ${ids.length} prompt${ids.length !== 1 ? "s" : ""}`
      );
    } catch (err) {
      toast.error(
        `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleDeleteCurrent = async () => {
    if (!selectedScript || selectedScript.id === "__new__") return;
    await handleDelete([selectedScript.id]);
  };

  const handleDuplicate = async () => {
    if (!selectedScript || selectedScript.id === "__new__") return;
    try {
      const duplicated = await runnerApi.duplicatePrompt(selectedScript.id);
      await refetch();
      setSelectedScript(duplicated);
      toast.success("Prompt duplicated");
    } catch (err) {
      toast.error(
        `Failed to duplicate: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      // If in improve mode, prepend the existing content
      const actualPrompt = aiMode === "improve" && editForm.content
        ? `Improve this prompt:\n\n${editForm.content}\n\nInstructions: ${prompt}`
        : prompt;
      const result = await runnerApi.aiGeneratePrompt(actualPrompt, aiMode);
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
    if (aiResult) {
      setEditForm(f => ({
        ...f,
        name: aiResult.name ?? f.name,
        description: aiResult.description ?? f.description,
        content: aiResult.content ?? f.content,
        category: aiResult.category ?? f.category,
        tags: aiResult.tags ?? f.tags,
      }));
      setAiResult(null);
    }
  };

  const promptTemplates = [
    { label: "Bug fix task", prompt: "Generate a prompt for an AI agent to find and fix bugs in a codebase" },
    { label: "Code review", prompt: "Generate a prompt for reviewing code changes and suggesting improvements" },
    { label: "Test writing", prompt: "Generate a prompt for writing comprehensive test coverage" },
    { label: "Refactoring", prompt: "Generate a prompt for refactoring code to improve maintainability" },
    { label: "Documentation", prompt: "Generate a prompt for writing technical documentation" },
  ];

  return (
    <BuilderLayout<SavedPrompt>
      title="AI Prompts"
      icon={FileCode}
      iconColor="text-orange-400"
      accentColor="orange"
      items={prompts ?? null}
      isLoading={isLoading}
      error={error}
      isOffline={isOffline}
      selectedItem={selectedScript}
      onSelect={handleSelect}
      onNew={handleNew}
      onDelete={handleDelete}
      refetch={refetch}
      emptyIcon={Code2}
      emptyTitle="No AI prompts yet"
      emptyDescription="Create AI prompts to use in your automation workflows."
      itemLabel="prompt"
      searchPlaceholder="Search prompts..."
      initialSelectedId={initialId}
      renderListItem={(item) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {item.name}
          </p>
          {item.description && (
            <p className="text-xs text-text-muted truncate">
              {item.description}
            </p>
          )}
        </div>
      )}
      renderEditor={(item) => (
        <div className="p-6 space-y-5">
          {/* AI Generator */}
          <AiGeneratorPanel
            title="Generate Prompt with AI"
            accentColor="amber"
            templates={aiMode === "generate" ? promptTemplates : undefined}
            placeholder={aiMode === "generate" ? "Describe what kind of AI prompt you need..." : "Describe how to improve the current prompt..."}
            generating={aiGenerating}
            error={aiError}
            onGenerate={handleAiGenerate}
            extraInputs={
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setAiMode("generate")}
                  className={`px-2 py-1 rounded text-xs transition-colors ${aiMode === "generate" ? "bg-amber-900/30 text-amber-400 border border-amber-500/30" : "bg-surface-raised/50 text-text-muted border border-border-subtle hover:border-text-muted"}`}
                >
                  Generate New
                </button>
                <button
                  type="button"
                  onClick={() => setAiMode("improve")}
                  className={`px-2 py-1 rounded text-xs transition-colors ${aiMode === "improve" ? "bg-amber-900/30 text-amber-400 border border-amber-500/30" : "bg-surface-raised/50 text-text-muted border border-border-subtle hover:border-text-muted"}`}
                >
                  Improve Existing
                </button>
              </div>
            }
            result={aiResult ? (
              <div className="space-y-2">
                {aiResult.name && <p className="text-sm font-medium text-text-primary">{aiResult.name}</p>}
                {aiResult.description && <p className="text-xs text-text-muted">{aiResult.description}</p>}
                {aiResult.content && (
                  <pre className="text-xs font-mono bg-surface-canvas p-2 rounded max-h-48 overflow-auto text-text-secondary whitespace-pre-wrap">{aiResult.content}</pre>
                )}
                {aiResult.category && (
                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">{aiResult.category}</span>
                )}
              </div>
            ) : undefined}
            onAccept={handleAiAccept}
            onRegenerate={() => setAiResult(null)}
            acceptLabel={aiMode === "improve" ? "Apply Improvements" : "Use Generated Prompt"}
            disclaimer="AI generates prompt content based on your description. Review before saving."
          />

          {/* Editor Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode className="size-5 text-orange-400" />
              <h2 className="text-lg font-semibold text-text-primary">
                {item.id === "__new__" ? "New Prompt" : "Edit Prompt"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleDuplicate}
                disabled={item.id === "__new__"}
              >
                <Copy className="size-3.5" />
                Duplicate
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-400 hover:text-red-300 hover:border-red-500/40"
                onClick={handleDeleteCurrent}
                disabled={item.id === "__new__"}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
              <Button
                variant="brand-primary"
                size="sm"
                className="gap-1.5"
                onClick={handleSave}
              >
                <Save className="size-3.5" />
                Save
              </Button>
            </div>
          </div>

          {/* Name */}
          <div>
            <Label className="text-xs text-text-muted">Name</Label>
            <Input
              value={editForm.name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="Prompt name"
              className="mt-1 bg-surface-raised/50 border-border-subtle"
            />
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs text-text-muted">Description</Label>
            <Textarea
              value={editForm.description}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Brief description of this prompt"
              rows={2}
              className="mt-1 bg-surface-raised/50 border-border-subtle resize-none"
            />
          </div>

          {/* Content (Monaco Editor) */}
          <div>
            <Label className="text-xs text-text-muted">Prompt Content</Label>
            <div className="mt-1 border border-border-subtle rounded-lg overflow-hidden">
              <Editor
                height="300px"
                language="markdown"
                theme="vs-dark"
                value={editForm.content}
                onChange={(value) =>
                  setEditForm((f) => ({ ...f, content: value ?? "" }))
                }
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  padding: { top: 8 },
                }}
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <Label className="text-xs text-text-muted">Category</Label>
            <Input
              value={editForm.category}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, category: e.target.value }))
              }
              placeholder="e.g. debugging, testing, deployment"
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
                placeholder="Add tag and press Enter..."
              />
            </div>
          </div>

          {/* Max Sessions */}
          <div>
            <Label className="text-xs text-text-muted">Max Sessions</Label>
            <Input
              type="number"
              value={editForm.max_sessions ?? ""}
              onChange={(e) =>
                setEditForm((f) => ({
                  ...f,
                  max_sessions: e.target.value
                    ? parseInt(e.target.value, 10)
                    : null,
                }))
              }
              placeholder="Unlimited"
              className="mt-1 bg-surface-raised/50 border-border-subtle"
            />
          </div>

          {/* Provider */}
          <div>
            <Label className="text-xs text-text-muted">Provider</Label>
            <Input
              value={editForm.provider}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, provider: e.target.value }))
              }
              placeholder="Default provider"
              className="mt-1 bg-surface-raised/50 border-border-subtle"
            />
          </div>

          {/* Model */}
          <div>
            <Label className="text-xs text-text-muted">Model</Label>
            <Input
              value={editForm.model}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, model: e.target.value }))
              }
              placeholder="Default model"
              className="mt-1 bg-surface-raised/50 border-border-subtle"
            />
          </div>

          {/* Orchestrator Settings */}
          <Collapsible
            open={orchestratorOpen}
            onOpenChange={setOrchestratorOpen}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors w-full"
              >
                <ChevronDown
                  className={`size-4 transition-transform ${orchestratorOpen ? "" : "-rotate-90"}`}
                />
                Orchestrator Settings
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4 pl-6">
              {/* Requires Orchestrator */}
              <div className="flex items-center gap-3">
                <Switch
                  checked={editForm.requires_orchestrator}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({
                      ...f,
                      requires_orchestrator: checked,
                    }))
                  }
                />
                <Label className="text-xs text-text-muted">
                  Requires Orchestrator
                </Label>
              </div>

              {editForm.requires_orchestrator && (
                <>
                  {/* Orchestrator Goal */}
                  <div>
                    <Label className="text-xs text-text-muted">
                      Orchestrator Goal
                    </Label>
                    <Textarea
                      value={editForm.orchestrator_goal}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          orchestrator_goal: e.target.value,
                        }))
                      }
                      placeholder="Describe the orchestrator goal..."
                      rows={3}
                      className="mt-1 bg-surface-raised/50 border-border-subtle resize-none"
                    />
                  </div>

                  {/* Orchestrator Max Iterations */}
                  <div>
                    <Label className="text-xs text-text-muted">
                      Max Iterations
                    </Label>
                    <Input
                      type="number"
                      value={editForm.orchestrator_max_iterations ?? ""}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          orchestrator_max_iterations: e.target.value
                            ? parseInt(e.target.value, 10)
                            : null,
                        }))
                      }
                      placeholder="Default iterations"
                      className="mt-1 bg-surface-raised/50 border-border-subtle"
                    />
                  </div>
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    />
  );
}

export default function ScriptsBuilderPage() {
  return (
    <Suspense>
      <ScriptsBuilderPageContent />
    </Suspense>
  );
}
