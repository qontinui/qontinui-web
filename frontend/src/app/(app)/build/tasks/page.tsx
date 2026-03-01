"use client";

import { useState } from "react";
import { FileText, Tags, Workflow } from "lucide-react";
import { BuilderLayout, type BuilderItem } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  usePromptsList,
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  useDuplicatePrompt,
} from "@/components/builders/hooks/useRunnerEntity";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";
import type { SavedPrompt } from "@/lib/runner/types/library";

// =============================================================================
// Adapter type for BuilderItem compatibility
// =============================================================================

interface TaskBuilderItem extends BuilderItem {
  content: string;
  description?: string | null;
  category?: string;
  tags?: string[];
  max_sessions?: number | null;
}

// =============================================================================
// Form State
// =============================================================================

interface TaskForm {
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  max_sessions: number | null;
}

function adaptPrompt(p: SavedPrompt): TaskBuilderItem {
  return {
    id: p.id,
    name: p.name,
    content: p.content,
    description: p.description,
    category: p.category,
    tags: p.tags,
    max_sessions: p.max_sessions,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function toForm(item: TaskBuilderItem): TaskForm {
  return {
    name: item.name,
    description: item.description || "",
    content: item.content,
    category: item.category || "",
    tags: item.tags || [],
    max_sessions: item.max_sessions ?? null,
  };
}

function defaultForm(): TaskForm {
  return {
    name: "",
    description: "",
    content: "",
    category: "",
    tags: [],
    max_sessions: null,
  };
}

function toPayload(form: TaskForm): Record<string, unknown> {
  return {
    name: form.name,
    content: form.content,
    description: form.description || undefined,
    category: form.category || undefined,
    tags: form.tags.length > 0 ? form.tags : undefined,
    max_sessions: form.max_sessions,
  };
}

// =============================================================================
// Main Component
// =============================================================================

export default function TasksPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);

  const { data: promptsData, isLoading, error } = usePromptsList();
  const createMutation = useCreatePrompt();
  const updateMutation = useUpdatePrompt();
  const deleteMutation = useDeletePrompt();
  const duplicateMutation = useDuplicatePrompt();

  const isOffline = !!error && !promptsData;
  const tasks: TaskBuilderItem[] = promptsData
    ? promptsData.map(adaptPrompt)
    : [];

  const builder = useBuilderPage<TaskBuilderItem, TaskForm>({
    items: tasks,
    isLoading,
    error,
    isOffline,
    toForm,
    defaultForm,
    toPayload,
    onCreate: (data) =>
      createMutation.mutateAsync(
        data as Parameters<typeof createMutation.mutateAsync>[0]
      ),
    onUpdate: (id, data) =>
      updateMutation.mutateAsync({
        id,
        data: data as Parameters<typeof updateMutation.mutateAsync>[0]["data"],
      }),
    onDelete: (id) => deleteMutation.mutateAsync(id),
    refetch: async () => {},
  });

  const handleDuplicateTask = async () => {
    if (!builder.selectedItem || builder.isNew) return;
    await duplicateMutation.mutateAsync(builder.selectedItem.id);
    await builder.refetch();
  };

  return (
    <>
    <BuilderLayout<TaskBuilderItem>
      title="Tasks"
      icon={FileText}
      iconColor="text-orange-400"
      accentColor="orange"
      items={builder.items}
      isLoading={builder.isLoading}
      error={builder.error}
      isOffline={builder.isOffline}
      selectedItem={builder.selectedItem}
      onSelect={builder.onSelect}
      onNew={builder.onNew}
      onDelete={builder.onDelete}
      refetch={builder.refetch}
      emptyIcon={FileText}
      emptyTitle="No tasks yet"
      emptyDescription="Create AI task prompts for your workflows"
      itemLabel="task"
      searchPlaceholder="Search tasks..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <TaskListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={(item) => {
        const task = item as TaskBuilderItem;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-orange-400"
            title="Insert into Workflow"
            onClick={(e) => {
              e.stopPropagation();
              setAddToWorkflowStep({
                type: "prompt",
                name: task.name,
                content: task.content,
                prompt_id: task.id,
                ...(task.max_sessions != null ? { max_sessions: task.max_sessions } : {}),
              });
            }}
          >
            <Workflow className="size-3.5" />
          </Button>
        );
      }}
      renderEditor={(item) => (
        <TaskEditor
          item={item}
          form={builder.form}
          setForm={builder.setForm}
          isDirty={builder.isDirty}
          isNew={builder.isNew}
          isSaving={builder.isSaving}
          onSave={builder.save}
          onDelete={builder.deleteSelected}
          onDuplicate={handleDuplicateTask}
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

function TaskListItem({
  item,
  isSelected,
}: {
  item: TaskBuilderItem;
  isSelected: boolean;
}) {
  const contentPreview = item.content.slice(0, 60);
  const truncated = item.content.length > 60;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <FileText
          className={`size-4 shrink-0 ${isSelected ? "text-orange-400" : "text-muted-foreground"}`}
        />
        <span
          className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}
        >
          {item.name}
        </span>
      </div>
      {item.category && (
        <div className="pl-6">
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-orange-500/10 text-orange-400 border-orange-500/30"
          >
            {item.category}
          </Badge>
        </div>
      )}
      <p className="text-xs text-muted-foreground font-mono truncate pl-6">
        {contentPreview}
        {truncated && "..."}
      </p>
    </div>
  );
}

// =============================================================================
// Editor
// =============================================================================

interface TaskEditorProps {
  item: TaskBuilderItem;
  form: TaskForm;
  setForm: (form: TaskForm | ((prev: TaskForm) => TaskForm)) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}

function TaskEditor({
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
  onDuplicate,
}: TaskEditorProps) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(
    null
  );

  const updateField = <K extends keyof TaskForm>(
    field: K,
    value: TaskForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await runnerApi.aiGeneratePrompt(prompt, "generate");
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
    setForm((prev) => ({
      ...prev,
      name: (data.name as string) || prev.name,
      content: (data.content as string) || prev.content,
      description: (data.description as string) || prev.description,
      category: (data.category as string) || prev.category,
      tags: Array.isArray(data.tags)
        ? data.tags.filter((t): t is string => typeof t === "string")
        : prev.tags,
    }));
    setAiResult(null);
  };

  return (
    <div className="flex flex-col h-full">
      <EditorHeader
        name={form.name}
        onNameChange={(name) => updateField("name", name)}
        onSave={onSave}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        isSaving={isSaving}
        isDirty={isDirty}
        isNew={isNew}
        nameplaceholder="Task name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Content */}
        <EditorSection title="Content" defaultOpen={true}>
          <MonacoField
            value={form.content}
            onChange={(value) => updateField("content", value)}
            language="markdown"
            height="400px"
          />
        </EditorSection>

        {/* Description */}
        <EditorSection title="Description" defaultOpen={true}>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this task does..."
            rows={2}
            className="bg-muted border-border text-sm resize-none"
          />
        </EditorSection>

        {/* Settings */}
        <EditorSection title="Settings" defaultOpen={false}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Sessions</Label>
              <Input
                type="number"
                min={0}
                value={form.max_sessions ?? ""}
                onChange={(e) =>
                  updateField(
                    "max_sessions",
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                placeholder="0 = unlimited"
                className="bg-muted border-border h-8 text-sm w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Input
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
                placeholder="e.g., code-review, bug-fix, feature"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>
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

        {/* AI Generator */}
        <AiGeneratorPanel
          title="AI Generate Task"
          accentColor="orange"
          placeholder="Describe the task to generate..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
          result={
            aiResult ? (
              <div className="space-y-2 text-xs">
                {typeof (aiResult.data as Record<string, unknown>)?.name ===
                  "string" && (
                  <div>
                    <span className="text-muted-foreground">Name: </span>
                    <span className="text-foreground">
                      {
                        (aiResult.data as Record<string, unknown>)
                          .name as string
                      }
                    </span>
                  </div>
                )}
                {typeof (aiResult.data as Record<string, unknown>)?.content ===
                  "string" && (
                  <pre className="font-mono text-muted-foreground bg-background rounded p-2 max-h-48 overflow-y-auto">
                    {(
                      (aiResult.data as Record<string, unknown>)
                        .content as string
                    ).slice(0, 500)}
                    {((aiResult.data as Record<string, unknown>)
                      .content as string).length > 500 && "\n..."}
                  </pre>
                )}
              </div>
            ) : undefined
          }
          onAccept={handleAiAccept}
          acceptLabel="Apply Task"
          templates={[
            {
              label: "Code review task",
              prompt:
                "Create a code review task that checks for best practices and potential issues",
            },
            {
              label: "Bug fix task",
              prompt:
                "Create a bug fix task that analyzes error logs and implements fixes",
            },
            {
              label: "Feature implementation task",
              prompt:
                "Create a feature implementation task with clear requirements and acceptance criteria",
            },
          ]}
        />
      </div>
    </div>
  );
}
