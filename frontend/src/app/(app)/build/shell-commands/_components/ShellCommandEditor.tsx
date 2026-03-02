"use client";

import { useState } from "react";
import { Settings, Tags } from "lucide-react";
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
import type { ShellCommandItem } from "@/services/library-service";
import type { ShellCommandForm, CommandTemplate } from "../shell-command-utils";
import { inferCategory } from "../constants";
import { CommandTemplates } from "./CommandTemplates";

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

export function ShellCommandEditor({ item, form, setForm, isDirty, isNew, isSaving, onSave, onDelete }: ShellCommandEditorProps) {
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
        {isNew && !templateApplied && (
          <CommandTemplates onSelectTemplate={handleTemplateSelect} />
        )}

        <div className="flex items-center gap-2">
          <currentCategory.icon className={`size-4 ${currentCategory.color}`} />
          <Badge variant="secondary" className={`text-xs px-2 py-0.5 ${currentCategory.bgColor} ${currentCategory.color}`}>
            {currentCategory.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            (auto-detected from command or tags)
          </span>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this command does..."
            className="min-h-[60px] text-sm bg-muted border-border resize-none"
          />
        </div>

        <EditorSection title="Command" defaultOpen={true}>
          <MonacoField
            value={form.command}
            onChange={(value) => updateField("command", value)}
            language="shell"
            height="200px"
          />
        </EditorSection>

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
