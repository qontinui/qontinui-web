"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Container, FileCode, GitBranch, Hammer, Package, Settings, Sparkles, Tags, Terminal, Workflow, type LucideIcon } from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  useShellCommandsList,
  useCreateShellCommand,
  useUpdateShellCommand,
  useDeleteShellCommand,
} from "@/hooks/useLibrary";
import { EditorHeader, EditorSection, ExecutionPanel, MonacoField, type ExecutionResult } from "@/components/builders/editors";
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
import type { ShellCommandItem, ShellCommandCreate } from "@/services/library-service";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";

// =============================================================================
// Category System
// =============================================================================

interface CommandTemplate {
  name: string;
  command: string;
  description: string;
}

interface CommandCategory {
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  commands: CommandTemplate[];
}

const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    value: "git",
    label: "Git",
    icon: GitBranch,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    commands: [
      { name: "Git Status", command: "git status", description: "Show working tree status" },
      { name: "Git Pull", command: "git pull", description: "Pull latest changes" },
      { name: "Git Push", command: "git push", description: "Push commits to remote" },
    ],
  },
  {
    value: "npm",
    label: "NPM",
    icon: Package,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    commands: [
      { name: "NPM Install", command: "npm install", description: "Install dependencies" },
      { name: "NPM Build", command: "npm run build", description: "Build project" },
      { name: "NPM Test", command: "npm test", description: "Run tests" },
    ],
  },
  {
    value: "docker",
    label: "Docker",
    icon: Container,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    commands: [
      { name: "Docker PS", command: "docker ps", description: "List running containers" },
      { name: "Docker Build", command: "docker build -t app .", description: "Build Docker image" },
    ],
  },
  {
    value: "poetry",
    label: "Poetry",
    icon: FileCode,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    commands: [
      { name: "Poetry Install", command: "poetry install", description: "Install Python dependencies" },
      { name: "Poetry Run", command: "poetry run python main.py", description: "Run with Poetry" },
    ],
  },
  {
    value: "build",
    label: "Build",
    icon: Hammer,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    commands: [
      { name: "Make Build", command: "make build", description: "Run make build" },
      { name: "Cargo Build", command: "cargo build --release", description: "Build Rust project" },
    ],
  },
  {
    value: "general",
    label: "General",
    icon: Terminal,
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    commands: [],
  },
];

/** Infer category from an item's tags or command content */
function inferCategory(item: ShellCommandItem): CommandCategory {
  const categoryValues = COMMAND_CATEGORIES.map((c) => c.value);

  // Check tags first -- a tag matching a category value is explicit
  if (item.tags) {
    for (const tag of item.tags) {
      const lower = tag.toLowerCase();
      if (categoryValues.includes(lower)) {
        return COMMAND_CATEGORIES.find((c) => c.value === lower)!;
      }
    }
  }

  // Infer from command content
  const cmd = item.command.toLowerCase();
  if (cmd.startsWith("git ") || cmd.includes("&& git ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "git")!;
  }
  if (cmd.startsWith("npm ") || cmd.startsWith("npx ") || cmd.startsWith("yarn ") || cmd.startsWith("pnpm ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "npm")!;
  }
  if (cmd.startsWith("docker ") || cmd.startsWith("docker-compose ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "docker")!;
  }
  if (cmd.startsWith("poetry ") || cmd.startsWith("pip ") || cmd.startsWith("python ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "poetry")!;
  }
  if (cmd.startsWith("make ") || cmd.startsWith("cargo ") || cmd.startsWith("cmake ")) {
    return COMMAND_CATEGORIES.find((c) => c.value === "build")!;
  }

  return COMMAND_CATEGORIES.find((c) => c.value === "general")!;
}

// =============================================================================
// Form State
// =============================================================================

interface ShellCommandForm {
  name: string;
  description: string;
  command: string;
  working_directory: string;
  platform: string;
  timeout_seconds: number;
  fail_on_error: boolean;
  enabled: boolean;
  tags: string[];
}

function toForm(item: ShellCommandItem): ShellCommandForm {
  return {
    name: item.name,
    description: item.description || "",
    command: item.command,
    working_directory: item.working_directory || "",
    platform: item.platform || "any",
    timeout_seconds: item.timeout_seconds,
    fail_on_error: item.fail_on_error,
    enabled: item.enabled,
    tags: item.tags || [],
  };
}

function defaultForm(): ShellCommandForm {
  return {
    name: "",
    description: "",
    command: "",
    working_directory: "",
    platform: "any",
    timeout_seconds: 300,
    fail_on_error: true,
    enabled: true,
    tags: [],
  };
}

function toPayload(form: ShellCommandForm): ShellCommandCreate {
  return {
    name: form.name,
    description: form.description || null,
    command: form.command,
    working_directory: form.working_directory || null,
    platform: form.platform === "any" ? null : form.platform,
    timeout_seconds: form.timeout_seconds,
    fail_on_error: form.fail_on_error,
    enabled: form.enabled,
    tags: form.tags,
  };
}

// =============================================================================
// Main Component
// =============================================================================

export default function ShellCommandsPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);
  const listQuery = useShellCommandsList();
  const createMutation = useCreateShellCommand();
  const updateMutation = useUpdateShellCommand();
  const deleteMutation = useDeleteShellCommand();

  const builder = useBuilderPage<ShellCommandItem, ShellCommandForm, ShellCommandCreate>({
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
    <BuilderLayout<ShellCommandItem>
      title="Shell Commands"
      icon={Terminal}
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
      emptyIcon={Terminal}
      emptyTitle="No shell commands yet"
      emptyDescription="Create reusable shell commands for automation"
      itemLabel="command"
      searchPlaceholder="Search commands..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <ShellCommandListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={(item) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
          title="Insert into Workflow"
          onClick={() => {
            setAddToWorkflowStep({
              type: "command",
              name: item.name,
              command: item.command,
              shell_command_id: item.id,
              working_directory: item.working_directory ?? undefined,
            });
          }}
        >
          <Workflow className="size-3.5" />
        </Button>
      )}
      renderEditor={(item) => (
        <ShellCommandEditor
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

function ShellCommandListItem({ item, isSelected }: { item: ShellCommandItem; isSelected: boolean }) {
  const category = inferCategory(item);
  const CategoryIcon = category.icon;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <CategoryIcon className={`size-4 shrink-0 ${item.enabled ? category.color : "text-muted-foreground"}`} />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <Badge
          variant="secondary"
          className={`text-[10px] px-1.5 ${category.bgColor} ${category.color}`}
        >
          {category.label}
        </Badge>
        {item.platform && item.platform !== "any" && (
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {item.platform}
          </Badge>
        )}
        <Badge variant="secondary" className={`text-[10px] px-1.5 ${item.enabled ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
          {item.enabled ? "enabled" : "disabled"}
        </Badge>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}

// =============================================================================
// Template Picker (shown for new commands)
// =============================================================================

interface CommandTemplatesProps {
  onSelectTemplate: (template: CommandTemplate, categoryValue: string) => void;
}

function CommandTemplates({ onSelectTemplate }: CommandTemplatesProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const categoriesWithTemplates = COMMAND_CATEGORIES.filter((c) => c.commands.length > 0);

  return (
    <EditorSection title="Quick Start Templates" icon={Sparkles} defaultOpen={true}>
      <p className="text-xs text-muted-foreground mb-3">
        Select a template to pre-fill the command fields, or start from scratch below.
      </p>
      <div className="space-y-1">
        {categoriesWithTemplates.map((category) => {
          const isExpanded = expandedCategory === category.value;
          const CategoryIcon = category.icon;

          return (
            <div key={category.value}>
              <button
                type="button"
                onClick={() => setExpandedCategory(isExpanded ? null : category.value)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-muted transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                )}
                <CategoryIcon className={`size-4 shrink-0 ${category.color}`} />
                <span className="text-sm font-medium text-muted-foreground">{category.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">{category.commands.length} templates</span>
              </button>
              {isExpanded && (
                <div className="ml-5 pl-4 border-l border-border space-y-0.5 mt-1 mb-2">
                  {category.commands.map((template) => (
                    <button
                      key={template.name}
                      type="button"
                      onClick={() => onSelectTemplate(template, category.value)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-muted/70 transition-colors group"
                    >
                      <div className="text-sm text-muted-foreground group-hover:text-foreground">
                        {template.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {template.command}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </EditorSection>
  );
}

// =============================================================================
// Editor
// =============================================================================

interface ShellCommandEditorProps {
  item: ShellCommandItem;
  form: ShellCommandForm;
  setForm: (form: ShellCommandForm | ((prev: ShellCommandForm) => ShellCommandForm)) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
}

function ShellCommandEditor({ item, form, setForm, isDirty, isNew, isSaving, onSave, onDelete }: ShellCommandEditorProps) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [templateApplied, setTemplateApplied] = useState(false);

  const updateField = <K extends keyof ShellCommandForm>(field: K, value: ShellCommandForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleTemplateSelect = (template: CommandTemplate, categoryValue: string) => {
    setForm((prev) => ({
      ...prev,
      name: template.name,
      description: template.description,
      command: template.command,
      // Add category as a tag if not already present
      tags: prev.tags.includes(categoryValue) ? prev.tags : [...prev.tags, categoryValue],
    }));
    setTemplateApplied(true);
  };

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    try {
      const result = await runnerApi.aiGenerateShellCommand(prompt);
      if (result && typeof result === "object") {
        const generated = result as Record<string, unknown>;
        setForm((prev) => ({
          ...prev,
          name: (generated.name as string) || prev.name,
          description: (generated.description as string) || prev.description,
          command: (generated.command as string) || prev.command,
          working_directory: (generated.working_directory as string) || prev.working_directory,
          platform: (generated.platform as string) || prev.platform,
          timeout_seconds: (generated.timeout_seconds as number) || prev.timeout_seconds,
        }));
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  // Determine the inferred category for display in the editor
  const currentCategory = inferCategory({
    ...item,
    command: form.command,
    tags: form.tags,
  } as ShellCommandItem);

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
        nameplaceholder="Shell command name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Template Picker -- only for new commands, hides after selection */}
        {isNew && !templateApplied && (
          <CommandTemplates onSelectTemplate={handleTemplateSelect} />
        )}

        {/* Category indicator */}
        <div className="flex items-center gap-2">
          <currentCategory.icon className={`size-4 ${currentCategory.color}`} />
          <Badge variant="secondary" className={`text-xs px-2 py-0.5 ${currentCategory.bgColor} ${currentCategory.color}`}>
            {currentCategory.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            (auto-detected from command or tags)
          </span>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this command does..."
            className="min-h-[60px] text-sm bg-muted border-border resize-none"
          />
        </div>

        {/* Command */}
        <EditorSection title="Command" defaultOpen={true}>
          <MonacoField
            value={form.command}
            onChange={(value) => updateField("command", value)}
            language="shell"
            height="200px"
          />
        </EditorSection>

        {/* Configuration */}
        <EditorSection title="Configuration" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Working Directory</Label>
              <Input
                value={form.working_directory}
                onChange={(e) => updateField("working_directory", e.target.value)}
                placeholder="/path/to/directory (optional)"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Platform</Label>
              <Select value={form.platform} onValueChange={(v) => updateField("platform", v)}>
                <SelectTrigger className="bg-muted border-border h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any Platform</SelectItem>
                  <SelectItem value="windows">Windows</SelectItem>
                  <SelectItem value="linux">Linux</SelectItem>
                  <SelectItem value="macos">macOS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Timeout (seconds)</Label>
              <Input
                type="number"
                value={form.timeout_seconds}
                onChange={(e) => updateField("timeout_seconds", parseInt(e.target.value, 10) || 300)}
                min={1}
                max={3600}
                className="bg-muted border-border h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
                <span className="text-sm text-muted-foreground">Fail on Error</span>
                <input
                  type="checkbox"
                  checked={form.fail_on_error}
                  onChange={(e) => updateField("fail_on_error", e.target.checked)}
                  className="w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
                <span className="text-sm text-muted-foreground">Enabled</span>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => updateField("enabled", e.target.checked)}
                  className="w-4 h-4"
                />
              </label>
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
          <p className="text-xs text-muted-foreground mt-2">
            Tip: Add a category tag (git, npm, docker, poetry, build) to categorize this command.
          </p>
        </EditorSection>

        {/* Execution */}
        {!isNew && (
          <ExecutionPanel
            onRun={async () => {
              try {
                const res = await runnerApi.runShellCommand(item.id);
                return {
                  success: (res.success as boolean) ?? (res.exit_code === 0),
                  stdout: (res.stdout as string) || "",
                  stderr: (res.stderr as string) || "",
                  exit_code: (res.exit_code as number) ?? -1,
                  output: (res.stdout as string) || (res.output as string) || "",
                  error: (res.stderr as string) || (res.error as string) || undefined,
                } as ExecutionResult;
              } catch (err) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : "Execution failed",
                } as ExecutionResult;
              }
            }}
            runLabel="Run Command"
            disabled={isNew}
          />
        )}

        {/* AI Generator */}
        <AiGeneratorPanel
          title="Generate with AI"
          accentColor="amber"
          templates={[
            { label: "Build command", prompt: "Create a shell command that builds a Node.js project using npm" },
            { label: "Deploy script", prompt: "Create a shell command that deploys a web application" },
            { label: "System check", prompt: "Create a shell command that checks system health and disk space" },
          ]}
          placeholder="Describe the shell command you want to create..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
        />
      </div>
    </div>
  );
}
