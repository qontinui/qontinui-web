"use client";

import { useState } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./contexts.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;
import { BookOpen, Settings, Tags, Workflow, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  useContextsList,
  useCreateContext,
  useUpdateContext,
  useDeleteContext,
} from "@/hooks/useLibrary";
import {
  EditorHeader,
  EditorSection,
  MonacoField,
} from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContextItem, ContextCreate } from "@/services/library-service";

// =============================================================================
// Form State
// =============================================================================

interface ContextForm {
  name: string;
  description: string;
  content: string;
  category: string;
  scope: string;
  enabled: boolean;
  tags: string[];
  auto_include_keywords: string[];
  auto_include_actions: string[];
  auto_include_error_patterns: string[];
}

function toForm(item: ContextItem): ContextForm {
  const autoInclude = item.auto_include as Record<string, unknown> | null;
  return {
    name: item.name,
    description: item.description || "",
    content: item.content,
    category: item.category || "",
    scope: item.scope || "global",
    enabled: item.enabled,
    tags: item.tags || [],
    auto_include_keywords: (autoInclude?.keywords as string[]) || [],
    auto_include_actions: (autoInclude?.action_types as string[]) || [],
    auto_include_error_patterns: (autoInclude?.error_patterns as string[]) || [],
  };
}

function defaultForm(): ContextForm {
  return {
    name: "",
    description: "",
    content: "",
    category: "",
    scope: "global",
    enabled: true,
    tags: [],
    auto_include_keywords: [],
    auto_include_actions: [],
    auto_include_error_patterns: [],
  };
}

function toPayload(form: ContextForm): ContextCreate {
  const hasAutoInclude =
    form.auto_include_keywords.length > 0 ||
    form.auto_include_actions.length > 0 ||
    form.auto_include_error_patterns.length > 0;

  return {
    name: form.name,
    description: form.description || null,
    content: form.content,
    category: form.category || null,
    scope: form.scope,
    enabled: form.enabled,
    tags: form.tags,
    auto_include: hasAutoInclude
      ? {
          keywords: form.auto_include_keywords.length > 0 ? form.auto_include_keywords : null,
          action_types: form.auto_include_actions.length > 0 ? form.auto_include_actions : null,
          error_patterns: form.auto_include_error_patterns.length > 0 ? form.auto_include_error_patterns : null,
        }
      : null,
  };
}

// =============================================================================
// Main Component
// =============================================================================

export default function ContextsPage() {
  usePageSpecs({ contexts: pageSpec });
  const listQuery = useContextsList();
  const createMutation = useCreateContext();
  const updateMutation = useUpdateContext();
  const deleteMutation = useDeleteContext();

  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);

  const builder = useBuilderPage<ContextItem, ContextForm, ContextCreate>({
    items: listQuery.data,
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    isOffline: false,
    toForm,
    defaultForm,
    toPayload,
    onCreate: (data) => createMutation.mutateAsync(data),
    onUpdate: (id, data) => updateMutation.mutateAsync({ id, data }),
    onDelete: (id) => deleteMutation.mutateAsync(id),
    refetch: () => listQuery.refetch(),
  });

  return (
    <>
    <BuilderLayout<ContextItem>
      title="Contexts"
      icon={BookOpen}
      iconColor="text-violet-400"
      accentColor="violet"
      items={builder.items}
      isLoading={builder.isLoading}
      error={builder.error}
      isOffline={builder.isOffline}
      selectedItem={builder.selectedItem}
      onSelect={builder.onSelect}
      onNew={builder.onNew}
      onDelete={builder.onDelete}
      refetch={builder.refetch}
      emptyIcon={BookOpen}
      emptyTitle="No contexts yet"
      emptyDescription="Create AI context documents for domain knowledge"
      itemLabel="context"
      searchPlaceholder="Search contexts..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <ContextListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={(item) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
          title="Insert into Workflow"
          onClick={() => {
            setAddToWorkflowStep({
              type: "prompt",
              name: `Context: ${item.name}`,
              content: `Use context: ${item.name}`,
            });
          }}
        >
          <Workflow className="size-3.5" />
        </Button>
      )}
      renderEditor={(item) => (
        <ContextEditor
          item={item}
          form={builder.form}
          setForm={builder.setForm}
          isDirty={builder.isDirty}
          isNew={builder.isNew}
          isSaving={builder.isSaving}
          onSave={builder.save}
          onDelete={builder.deleteSelected}
          onDuplicate={async () => {
            const payload = toPayload({
              ...toForm(item),
              name: `${item.name} (Copy)`,
              scope: item.scope === "builtin" ? "global" : (item.scope || "global"),
            });
            try {
              await createMutation.mutateAsync(payload);
            } catch {
              // Ignore duplicate error
            }
          }}
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

function ContextListItem({ item, isSelected }: { item: ContextItem; isSelected: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-violet-400 shrink-0" />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        {item.category && (
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {item.category}
          </Badge>
        )}
        <Badge variant="secondary" className={`text-[10px] px-1.5 ${item.enabled ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
          {item.enabled ? "enabled" : "disabled"}
        </Badge>
        <span className="text-[10px] text-muted-foreground">{item.scope || "global"}</span>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}

// =============================================================================
// Editor
// =============================================================================

interface ContextEditorProps {
  item: ContextItem;
  form: ContextForm;
  setForm: (form: ContextForm | ((prev: ContextForm) => ContextForm)) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}

function ContextEditor({ item, form, setForm, isDirty, isNew, isSaving, onSave, onDelete, onDuplicate }: ContextEditorProps) {
  const isBuiltIn = item.scope === "builtin" || form.scope === "builtin";
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const updateField = <K extends keyof ContextForm>(field: K, value: ContextForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    try {
      const result = await runnerApi.aiGenerateContext(prompt);
      const d = result.data as Record<string, unknown>;
      if (d.content) {
        setForm((prev) => ({
          ...prev,
          content: d.content as string,
          name: (d.suggested_name as string) || prev.name,
          description: (d.suggested_description as string) || prev.description,
          category: (d.suggested_category as string) || prev.category,
        }));
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <EditorHeader
        name={form.name}
        onNameChange={(name) => { if (!isBuiltIn) updateField("name", name); }}
        onSave={isBuiltIn ? () => {} : onSave}
        onDelete={isBuiltIn ? undefined : onDelete}
        onDuplicate={onDuplicate}
        isSaving={isSaving}
        isDirty={isBuiltIn ? false : isDirty}
        isNew={isNew}
        nameplaceholder="Context name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Built-in context warning */}
        {isBuiltIn && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Shield className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex-1">
              <span className="text-xs font-medium text-amber-400">
                Built-in Context — Read Only
              </span>
              <p className="text-[10px] text-amber-400/70 mt-0.5">
                Built-in contexts cannot be edited. Use the duplicate feature to create an editable copy.
              </p>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Brief description of this context"
            className="min-h-[60px] text-sm bg-muted border-border resize-none"
            disabled={isBuiltIn}
          />
        </div>

        {/* Content */}
        <EditorSection title="Content" defaultOpen={true}>
          <MonacoField
            value={form.content}
            onChange={(value) => { if (!isBuiltIn) updateField("content", value); }}
            language="markdown"
            height="300px"
          />
        </EditorSection>

        {/* Settings */}
        <EditorSection title="Settings" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Input
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
                placeholder="e.g., System, Domain, Error Handling"
                className="bg-muted border-border h-8 text-sm"
                disabled={isBuiltIn}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Scope</Label>
              {form.scope === "builtin" ? (
                <div className="flex items-center gap-2 h-8 px-3 bg-muted rounded-md border border-border">
                  <span className="text-sm text-muted-foreground">Built-in</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 bg-violet-500/10 text-violet-400">
                    read-only
                  </Badge>
                </div>
              ) : (
                <Select value={form.scope} onValueChange={(v) => updateField("scope", v)}>
                  <SelectTrigger className="bg-muted border-border h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="workflow">Workflow</SelectItem>
                    <SelectItem value="task">Task</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
              <span className="text-sm text-muted-foreground">Enabled</span>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => updateField("enabled", e.target.checked)}
                className="w-4 h-4"
                disabled={isBuiltIn}
              />
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

        {/* Auto-Include Rules */}
        <EditorSection title="Auto-Include Rules" icon={Zap} defaultOpen={false}>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Context will be automatically included in AI tasks when any of these conditions match.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Task Keywords</Label>
              <TagInput
                tags={form.auto_include_keywords}
                onChange={(keywords) => updateField("auto_include_keywords", keywords)}
                placeholder="Add keyword..."
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Action Types</Label>
              <div className="flex flex-wrap gap-1.5">
                {["setup", "verification", "agentic", "completion", "shell_command", "playwright", "api_request", "vision_check"].map((actionType) => {
                  const isActive = form.auto_include_actions.includes(actionType);
                  return (
                    <button
                      key={actionType}
                      type="button"
                      disabled={isBuiltIn}
                      onClick={() => {
                        if (isActive) {
                          updateField("auto_include_actions", form.auto_include_actions.filter((a) => a !== actionType));
                        } else {
                          updateField("auto_include_actions", [...form.auto_include_actions, actionType]);
                        }
                      }}
                      className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                        isActive
                          ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                          : "bg-muted/30 border-border text-muted-foreground hover:border-border hover:text-muted-foreground"
                      } ${isBuiltIn ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {actionType.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
              <TagInput
                tags={form.auto_include_actions.filter((a) => !["setup", "verification", "agentic", "completion", "shell_command", "playwright", "api_request", "vision_check"].includes(a))}
                onChange={(custom) => {
                  const builtIn = form.auto_include_actions.filter((a) => ["setup", "verification", "agentic", "completion", "shell_command", "playwright", "api_request", "vision_check"].includes(a));
                  updateField("auto_include_actions", [...builtIn, ...custom]);
                }}
                placeholder="Custom action type..."
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Error Patterns</Label>
              <TagInput
                tags={form.auto_include_error_patterns}
                onChange={(patterns) => updateField("auto_include_error_patterns", patterns)}
                placeholder="Add error pattern..."
              />
            </div>
          </div>
        </EditorSection>

        {/* AI Generator */}
        <AiGeneratorPanel
          title="Generate with AI"
          accentColor="violet"
          templates={[
            { label: "System context", prompt: "Create a system context with guidelines for code quality" },
            { label: "Domain knowledge", prompt: "Create domain knowledge about web automation and testing" },
            { label: "Error handling", prompt: "Create error handling context with recovery strategies" },
          ]}
          placeholder="Describe the context you want to generate..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
        />
      </div>
    </div>
  );
}
