"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { DeleteConfirmDialog } from "@/components/builders/DeleteConfirmDialog";
import { TagInput } from "@/components/builders/TagInput";
import {
  type Scriptlet,
  runnerApi,
  useScriptletsDetailed,
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
import { Code2, Trash2, Save, Copy } from "lucide-react";

interface ScriptletForm {
  id: string;
  name: string;
  content: string;
  category: string;
  tags: string[];
}

const defaultForm: ScriptletForm = {
  id: "",
  name: "",
  content: "",
  category: "",
  tags: [],
};

function scriptletToForm(scriptlet: Scriptlet): ScriptletForm {
  return {
    id: scriptlet.id,
    name: scriptlet.name,
    content: scriptlet.content ?? "",
    category: scriptlet.category ?? "",
    tags: scriptlet.tags ?? [],
  };
}

export default function ScriptletsBuilderPage() {
  const searchParams = useSearchParams();
  const initialSelectedId = searchParams.get("id");
  const {
    data: scriptlets,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useScriptletsDetailed();
  const [selectedScriptlet, setSelectedScriptlet] =
    useState<Scriptlet | null>(null);
  const [editForm, setEditForm] = useState<ScriptletForm>(defaultForm);
  const [singleDeleteOpen, setSingleDeleteOpen] = useState(false);

  useEffect(() => {
    if (selectedScriptlet) {
      setEditForm(scriptletToForm(selectedScriptlet));
    }
  }, [selectedScriptlet]);

  const handleSelect = useCallback((item: Scriptlet | null) => {
    setSelectedScriptlet(item);
    if (!item) {
      setEditForm(defaultForm);
    }
  }, []);

  const handleNew = useCallback(() => {
    const newScriptlet: Scriptlet = {
      id: `new-${Date.now()}`,
      name: "New Scriptlet",
      content: "",
    };
    setSelectedScriptlet(newScriptlet);
    setEditForm({
      ...defaultForm,
      id: newScriptlet.id,
      name: newScriptlet.name,
    });
  }, []);

  const isNew = selectedScriptlet?.id.startsWith("new-") ?? false;

  const handleSave = useCallback(async () => {
    try {
      const payload: Partial<Scriptlet> = {
        name: editForm.name,
        content: editForm.content,
        category: editForm.category || undefined,
        tags: editForm.tags,
      };

      if (isNew) {
        const created = await runnerApi.createScriptlet(payload);
        await refetch();
        setSelectedScriptlet(created);
        toast.success("Scriptlet created");
      } else if (selectedScriptlet) {
        const updated = await runnerApi.updateScriptlet(
          selectedScriptlet.id,
          payload
        );
        await refetch();
        setSelectedScriptlet(updated);
        toast.success("Scriptlet updated");
      }
    } catch (err) {
      toast.error(
        `Failed to save scriptlet: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [editForm, isNew, selectedScriptlet, refetch]);

  const handleDelete = useCallback(
    async (ids: string[]) => {
      try {
        for (const id of ids) {
          await runnerApi.deleteScriptlet(id);
        }
        await refetch();
        setSelectedScriptlet(null);
        setEditForm(defaultForm);
        toast.success(
          `Deleted ${ids.length} scriptlet${ids.length !== 1 ? "s" : ""}`
        );
      } catch (err) {
        toast.error(
          `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [refetch]
  );

  // AI generation state
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [aiLanguage, setAiLanguage] = useState("python");

  const scriptletTemplates = [
    { label: "Data extraction snippet", prompt: "Create a scriptlet that extracts structured data from a page or output" },
    { label: "Element interaction helper", prompt: "Create a helper scriptlet for interacting with UI elements" },
    { label: "Validation utility", prompt: "Create a validation utility scriptlet that checks conditions" },
    { label: "API call wrapper", prompt: "Create a scriptlet that wraps an API call with error handling" },
  ];

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const result = await runnerApi.aiGenerateScriptlet(prompt, aiLanguage);
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
      content: (data.content as string) ?? (data.code as string) ?? f.content,
      category: (data.category as string) ?? f.category,
      tags: (data.tags as string[]) ?? f.tags,
    }));
    setAiResult(null);
    toast.success("AI-generated scriptlet accepted");
  };

  const handleDuplicate = useCallback(async () => {
    if (!selectedScriptlet || isNew) return;
    try {
      const duplicated = await runnerApi.createScriptlet({
        name: `${selectedScriptlet.name} (copy)`,
        content: editForm.content,
        category: editForm.category || undefined,
        tags: editForm.tags,
      });
      await refetch();
      setSelectedScriptlet(duplicated);
      setEditForm(scriptletToForm(duplicated));
      toast.success("Scriptlet duplicated");
    } catch (err) {
      toast.error(
        `Failed to duplicate: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [selectedScriptlet, isNew, editForm, refetch]);

  return (
    <BuilderLayout<Scriptlet>
      title="Scriptlets"
      icon={Code2}
      iconColor="text-emerald-400"
      accentColor="emerald"
      items={scriptlets ?? null}
      isLoading={isLoading}
      error={error}
      isOffline={isOffline}
      selectedItem={selectedScriptlet}
      onSelect={handleSelect}
      onNew={handleNew}
      onDelete={handleDelete}
      refetch={refetch}
      emptyIcon={Code2}
      emptyTitle="No scriptlets yet"
      emptyDescription="Create reusable scriptlets for your automation workflows."
      itemLabel="scriptlet"
      searchPlaceholder="Search scriptlets..."
      initialSelectedId={initialSelectedId}
      renderListItem={(item) => (
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span data-content-role="label" data-content-label="scriptlet name" className="text-sm font-medium text-text-primary truncate">
                {item.name}
              </span>
              {item.category && (
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 shrink-0"
                >
                  {item.category}
                </Badge>
              )}
            </div>
            {item.content && (
              <p className="text-xs text-text-muted truncate mt-0.5">
                {(item.content.split("\n")[0] ?? "").slice(0, 80)}
              </p>
            )}
          </div>
        </div>
      )}
      renderEditor={() => (
        <div className="p-6">
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
              title="Generate Scriptlet with AI"
              accentColor="violet"
              templates={scriptletTemplates}
              placeholder="Describe the scriptlet you want to create..."
              generating={aiGenerating}
              error={aiError}
              onGenerate={handleAiGenerate}
              extraInputs={
                <div className="space-y-1">
                  <Label className="text-xs text-text-muted">Language</Label>
                  <Select value={aiLanguage} onValueChange={setAiLanguage}>
                    <SelectTrigger className="h-8 text-xs bg-surface-canvas/50 border-border-subtle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="python">Python</SelectItem>
                      <SelectItem value="typescript">TypeScript</SelectItem>
                      <SelectItem value="javascript">JavaScript</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              }
              result={aiResult ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-text-primary">{aiResult.name as string ?? "Generated Scriptlet"}</p>
                  {typeof aiResult.category === "string" && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {aiResult.category}
                    </Badge>
                  )}
                  {(typeof aiResult.content === "string" || typeof aiResult.code === "string") && (
                    <pre className="text-xs text-text-muted bg-surface-canvas/60 rounded p-2 overflow-auto max-h-48 font-mono">
                      {String(aiResult.content ?? aiResult.code)}
                    </pre>
                  )}
                </div>
              ) : undefined}
              onAccept={handleAiAccept}
              onRegenerate={() => setAiResult(null)}
              disclaimer="AI generates code based on your description."
            />

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

            <div>
              <Label className="text-xs text-text-muted">Category</Label>
              <Input
                value={editForm.category}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, category: e.target.value }))
                }
                placeholder="e.g. setup, cleanup, utility"
                className="mt-1 bg-surface-raised/50 border-border-subtle"
              />
            </div>

            <div>
              <Label className="text-xs text-text-muted">Tags</Label>
              <div className="mt-1">
                <TagInput
                  tags={editForm.tags}
                  onChange={(tags) => setEditForm((f) => ({ ...f, tags }))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-text-muted">Content</Label>
              <Textarea
                value={editForm.content}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, content: e.target.value }))
                }
                rows={20}
                className="mt-1 bg-surface-raised/50 border-border-subtle font-mono text-sm leading-relaxed resize-y"
                placeholder="Enter scriptlet content..."
                spellCheck={false}
              />
            </div>
          </div>

          <DeleteConfirmDialog
            open={singleDeleteOpen}
            onOpenChange={setSingleDeleteOpen}
            onConfirm={() => {
              if (selectedScriptlet && !isNew) {
                handleDelete([selectedScriptlet.id]);
                setSingleDeleteOpen(false);
              }
            }}
            title="Delete Scriptlet"
            itemNames={[editForm.name]}
          />
        </div>
      )}
    />
  );
}
