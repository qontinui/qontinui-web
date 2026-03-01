"use client";

import { useState, useMemo, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Settings,
  AlertTriangle,
  Tags,
  Sparkles,
  FolderSearch,
  Wrench,
  Workflow,
  Layers,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  useChecksList,
  useCreateCheck,
  useUpdateCheck,
  useDeleteCheck,
  useCheckGroupsList,
  useCreateCheckGroup,
  useUpdateCheckGroup,
  useDeleteCheckGroup,
} from "@/hooks/useLibrary";
import { EditorHeader, EditorSection, ExecutionPanel, MonacoField, type ExecutionResult } from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { AssignChecksDialog } from "@/components/builders/AssignChecksDialog";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CheckItem, CheckCreate, CheckGroupItem, CheckGroupCreate } from "@/services/library-service";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";
import {
  CHECK_TYPES,
  CHECK_TYPE_BADGE_COLORS,
  getToolsForCheckType,
  getCheckDefaults,
  getCheckTypeInfo,
} from "./constants";

// =============================================================================
// Tab Types
// =============================================================================

type TabId = "checks" | "groups";

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active
          ? "bg-muted text-foreground border border-border"
          : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
      {count != null && (
        <Badge variant="secondary" className="text-[10px] px-1.5 ml-0.5">
          {count}
        </Badge>
      )}
    </button>
  );
}

// =============================================================================
// Check Form State
// =============================================================================

interface CheckForm {
  name: string;
  description: string;
  check_type: string;
  tool: string;
  command: string;
  working_directory: string;
  config_path: string;
  auto_fix: boolean;
  fail_on_warning: boolean;
  is_critical: boolean;
  timeout_seconds: number;
  enabled: boolean;
  tags: string[];
  ai_generated: boolean;
}

function toCheckForm(item: CheckItem): CheckForm {
  return {
    name: item.name,
    description: item.description || "",
    check_type: item.check_type,
    tool: item.tool || "custom",
    command: item.command || "",
    working_directory: item.working_directory || "",
    config_path: item.config_path || "",
    auto_fix: item.auto_fix,
    fail_on_warning: item.fail_on_warning,
    is_critical: item.is_critical,
    timeout_seconds: item.timeout_seconds,
    enabled: item.enabled,
    tags: item.tags || [],
    ai_generated: false,
  };
}

function defaultCheckForm(): CheckForm {
  return {
    name: "",
    description: "",
    check_type: "linter",
    tool: "custom",
    command: "",
    working_directory: "",
    config_path: "",
    auto_fix: false,
    fail_on_warning: false,
    is_critical: false,
    timeout_seconds: 300,
    enabled: true,
    tags: [],
    ai_generated: false,
  };
}

function toCheckPayload(form: CheckForm): CheckCreate {
  return {
    name: form.name,
    description: form.description || null,
    check_type: form.check_type,
    tool: form.tool || null,
    command: form.command || null,
    working_directory: form.working_directory || null,
    config_path: form.config_path || null,
    auto_fix: form.auto_fix,
    fail_on_warning: form.fail_on_warning,
    is_critical: form.is_critical,
    timeout_seconds: form.timeout_seconds,
    enabled: form.enabled,
    tags: form.tags,
  };
}

// =============================================================================
// Check Group Form State
// =============================================================================

interface CheckGroupForm {
  name: string;
  description: string;
  check_ids: string[];
  stop_on_failure: boolean;
  run_in_parallel: boolean;
  tags: string[];
}

function toGroupForm(item: CheckGroupItem): CheckGroupForm {
  return {
    name: item.name,
    description: item.description || "",
    check_ids: item.check_ids || [],
    stop_on_failure: item.stop_on_failure,
    run_in_parallel: item.run_in_parallel,
    tags: item.tags || [],
  };
}

function defaultGroupForm(): CheckGroupForm {
  return {
    name: "",
    description: "",
    check_ids: [],
    stop_on_failure: true,
    run_in_parallel: false,
    tags: [],
  };
}

function toGroupPayload(form: CheckGroupForm): CheckGroupCreate {
  return {
    name: form.name,
    description: form.description || null,
    check_ids: form.check_ids,
    stop_on_failure: form.stop_on_failure,
    run_in_parallel: form.run_in_parallel,
    tags: form.tags,
  };
}

// =============================================================================
// Check Creation Dialog
// =============================================================================

interface CheckCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateCheck: (checkType: string, tool: string) => void;
}

function CheckCreationDialog({ open, onOpenChange, onCreateCheck }: CheckCreationDialogProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const handleTypeSelect = (type: string) => {
    setSelectedType(type);
  };

  const handleToolSelect = (tool: string) => {
    if (!selectedType) return;
    onCreateCheck(selectedType, tool);
    setSelectedType(null);
    onOpenChange(false);
  };

  const handleBack = () => {
    setSelectedType(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedType(null);
    }
    onOpenChange(newOpen);
  };

  const tools = selectedType ? getToolsForCheckType(selectedType) : [];
  const typeInfo = selectedType ? getCheckTypeInfo(selectedType) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selectedType ? `Select Tool - ${typeInfo?.label}` : "New Check"}
          </DialogTitle>
          <DialogDescription>
            {selectedType
              ? "Choose a tool to get sensible defaults for your check."
              : "Select a check type to get started."}
          </DialogDescription>
        </DialogHeader>

        {!selectedType ? (
          /* Step 1: Select check type */
          <div className="grid grid-cols-2 gap-2 mt-2">
            {CHECK_TYPES.map((type) => {
              const colors = CHECK_TYPE_BADGE_COLORS[type.value];
              return (
                <button
                  key={type.value}
                  onClick={() => handleTypeSelect(type.value)}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-colors
                    border-border hover:border-text-muted bg-muted/50 hover:bg-muted
                    text-left`}
                >
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 ${colors?.bg ?? ""} ${colors?.text ?? ""} ${colors?.border ?? ""}`}
                  >
                    {type.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {type.tools.filter((t) => t !== "custom").join(", ") || "Custom command"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          /* Step 2: Select tool */
          <div className="space-y-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground mb-1"
              onClick={handleBack}
            >
              &larr; Back to types
            </Button>
            <div className="grid gap-2">
              {tools.map((tool) => {
                const defaults = getCheckDefaults(selectedType, tool);
                return (
                  <button
                    key={tool}
                    onClick={() => handleToolSelect(tool)}
                    className="flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors
                      border-border hover:border-text-muted bg-muted/50 hover:bg-muted
                      text-left"
                  >
                    <span className="text-sm font-medium text-foreground">{defaults.name}</span>
                    {defaults.command && (
                      <code className="text-[11px] text-muted-foreground font-mono truncate max-w-full">
                        {defaults.command}
                      </code>
                    )}
                    {defaults.description && (
                      <span className="text-xs text-muted-foreground">{defaults.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// AI Workspace Scanner
// =============================================================================

interface SuggestedCheck {
  name: string;
  check_type: string;
  tool: string;
  command: string;
  description: string;
  reason?: string;
}

interface AiWorkspaceScannerProps {
  onAcceptChecks: (checks: SuggestedCheck[]) => void;
}

function AiWorkspaceScanner({ onAcceptChecks }: AiWorkspaceScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [, setScanResult] = useState<Record<string, unknown> | null>(null);
  const [suggestedChecks, setSuggestedChecks] = useState<SuggestedCheck[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [workspaceDir, setWorkspaceDir] = useState("");

  const handleScan = async () => {
    if (!workspaceDir.trim()) {
      setError("Please enter a workspace directory path.");
      return;
    }
    setScanning(true);
    setError(null);
    setScanResult(null);
    setSuggestedChecks([]);
    setSelectedSuggestions(new Set());

    try {
      const result = await runnerApi.scanWorkspace(workspaceDir.trim());
      setScanResult(result);

      // Now generate checks from scan
      setGenerating(true);
      const genResult = await runnerApi.generateChecks(result);
      if (genResult.success && genResult.suggested_checks) {
        const checks: SuggestedCheck[] = genResult.suggested_checks.map((sc) => ({
          name: sc.name || sc.check?.name || "Unnamed Check",
          check_type: sc.check?.check_type || "custom",
          tool: sc.check?.tool || "custom",
          command: sc.command || sc.check?.command || "",
          description: sc.reason || "",
          reason: sc.reason,
        }));
        setSuggestedChecks(checks);
        setSelectedSuggestions(new Set(checks.map((_, i) => i)));
      } else {
        setError(genResult.error || "Failed to generate check suggestions.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace scan failed. Make sure the runner is connected.");
    } finally {
      setScanning(false);
      setGenerating(false);
    }
  };

  const toggleSuggestion = (index: number) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleAccept = () => {
    const selected = suggestedChecks.filter((_, i) => selectedSuggestions.has(i));
    if (selected.length > 0) {
      onAcceptChecks(selected);
      setSuggestedChecks([]);
      setScanResult(null);
      setSelectedSuggestions(new Set());
    }
  };

  return (
    <AiGeneratorPanel
      title="AI Workspace Scanner"
      icon={FolderSearch}
      accentColor="violet"
      placeholder="Enter workspace directory path to scan..."
      generating={scanning || generating}
      error={error}
      onGenerate={(prompt) => {
        setWorkspaceDir(prompt);
        handleScan();
      }}
      extraInputs={
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Workspace Directory</Label>
          <Input
            value={workspaceDir}
            onChange={(e) => setWorkspaceDir(e.target.value)}
            placeholder="C:/path/to/your/project"
            className="bg-muted border-border h-8 text-sm"
          />
        </div>
      }
      templates={[
        { label: "Current Dir", prompt: "." },
        { label: "Parent Dir", prompt: ".." },
      ]}
      result={
        suggestedChecks.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {suggestedChecks.length} checks suggested
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedSuggestions.size} selected
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {suggestedChecks.map((check, i) => {
                const colors = CHECK_TYPE_BADGE_COLORS[check.check_type];
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                      ${selectedSuggestions.has(i)
                        ? "border-violet-500/40 bg-violet-500/5"
                        : "border-border bg-muted/50"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(i)}
                      onChange={() => toggleSuggestion(i)}
                      className="mt-0.5 w-3.5 h-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">{check.name}</span>
                        <Badge
                          variant="secondary"
                          className={`text-[9px] px-1 ${colors?.bg ?? ""} ${colors?.text ?? ""} ${colors?.border ?? ""}`}
                        >
                          {check.check_type}
                        </Badge>
                      </div>
                      {check.command && (
                        <code className="text-[10px] text-muted-foreground font-mono block truncate">
                          {check.command}
                        </code>
                      )}
                      {check.reason && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{check.reason}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ) : undefined
      }
      onAccept={suggestedChecks.length > 0 ? handleAccept : undefined}
      acceptLabel={`Create ${selectedSuggestions.size} Check${selectedSuggestions.size !== 1 ? "s" : ""}`}
    />
  );
}

// =============================================================================
// Check List Item
// =============================================================================

function CheckListItem({ item, isSelected }: { item: CheckItem; isSelected: boolean }) {
  const typeLabel = CHECK_TYPES.find((t) => t.value === item.check_type)?.label || item.check_type;
  const colors = CHECK_TYPE_BADGE_COLORS[item.check_type] || { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30" };
  const isAiGenerated = item.tags?.includes("ai-generated");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <CheckCircle2
          className={`size-4 shrink-0 ${item.enabled ? "text-green-400" : "text-muted-foreground"}`}
        />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <Badge
          variant="secondary"
          className={`text-[10px] px-1.5 ${colors.bg} ${colors.text} ${colors.border}`}
        >
          {typeLabel}
        </Badge>
        {item.is_critical && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-red-500/10 text-red-400 border-red-500/30">
            Critical
          </Badge>
        )}
        {item.auto_fix && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-blue-500/10 text-blue-400 border-blue-500/30">
            Auto-fix
          </Badge>
        )}
        {isAiGenerated && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-purple-500/10 text-purple-400 border-purple-500/30">
            <Sparkles className="size-2.5 mr-0.5" />
            AI
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}

// =============================================================================
// Check Editor
// =============================================================================

interface CheckEditorProps {
  item: CheckItem;
  form: CheckForm;
  setForm: (form: CheckForm | ((prev: CheckForm) => CheckForm)) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  onAcceptAiChecks: (checks: SuggestedCheck[]) => void;
}

function CheckEditor({ item, form, setForm, isDirty, isNew, isSaving, onSave, onDelete, onAcceptAiChecks }: CheckEditorProps) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const updateField = <K extends keyof CheckForm>(field: K, value: CheckForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const availableTools = getToolsForCheckType(form.check_type);

  const handleCheckTypeChange = (checkType: string) => {
    const tools = getToolsForCheckType(checkType);
    const newTool = tools[0] || "custom";
    const defaults = getCheckDefaults(checkType, newTool);
    setForm((prev) => ({
      ...prev,
      check_type: checkType,
      tool: newTool,
      command: defaults.command || prev.command,
      description: defaults.description || prev.description,
      auto_fix: defaults.auto_fix,
    }));
  };

  const handleToolChange = (tool: string) => {
    const defaults = getCheckDefaults(form.check_type, tool);
    setForm((prev) => ({
      ...prev,
      tool,
      command: defaults.command || prev.command,
      description: defaults.description || prev.description,
      auto_fix: defaults.auto_fix,
    }));
  };

  const handleAiGenerate = async (_prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setAiError("AI generation not implemented yet");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
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
        nameplaceholder="Check name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* AI Generated indicator */}
        {form.ai_generated && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <Sparkles className="size-4 text-purple-400" />
            <span className="text-xs text-purple-400">This check was generated by AI</span>
          </div>
        )}

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this check does..."
            className="min-h-[60px] text-sm bg-muted border-border resize-none"
          />
        </div>

        {/* Check Configuration */}
        <EditorSection title="Check Configuration" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Check Type</Label>
                <Select value={form.check_type} onValueChange={handleCheckTypeChange}>
                  <SelectTrigger className="bg-muted border-border h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHECK_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tool</Label>
                <Select value={form.tool} onValueChange={handleToolChange}>
                  <SelectTrigger className="bg-muted border-border h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTools.map((tool) => (
                      <SelectItem key={tool} value={tool}>
                        {tool}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Command */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Command</Label>
              <MonacoField
                value={form.command}
                onChange={(value) => updateField("command", value)}
                language="shell"
                height="120px"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Working Directory</Label>
                <Input
                  value={form.working_directory}
                  onChange={(e) => updateField("working_directory", e.target.value)}
                  placeholder="/path/to/project"
                  className="bg-muted border-border h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Config Path</Label>
                <Input
                  value={form.config_path}
                  onChange={(e) => updateField("config_path", e.target.value)}
                  placeholder=".eslintrc.json"
                  className="bg-muted border-border h-8 text-sm"
                />
              </div>
            </div>
          </div>
        </EditorSection>

        {/* Behavior */}
        <EditorSection title="Behavior" icon={AlertTriangle} defaultOpen={true}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Wrench className="size-3.5 text-blue-400" />
                  Auto-Fix
                </span>
                <input
                  type="checkbox"
                  checked={form.auto_fix}
                  onChange={(e) => updateField("auto_fix", e.target.checked)}
                  className="w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
                <span className="text-sm text-muted-foreground">Fail on Warning</span>
                <input
                  type="checkbox"
                  checked={form.fail_on_warning}
                  onChange={(e) => updateField("fail_on_warning", e.target.checked)}
                  className="w-4 h-4"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5 text-red-400" />
                  Critical
                </span>
                <input
                  type="checkbox"
                  checked={form.is_critical}
                  onChange={(e) => updateField("is_critical", e.target.checked)}
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

        {/* Execution with enhanced results */}
        {!isNew && (
          <ExecutionPanel
            onRun={async () => {
              try {
                const response = await runnerApi.runCheck(item.id);
                const status = (response as Record<string, unknown>).status as string | undefined;
                const issuesFound = (response as Record<string, unknown>).issues_found as number | undefined;
                const issuesFixed = (response as Record<string, unknown>).issues_fixed as number | undefined;
                const filesChecked = (response as Record<string, unknown>).files_checked as number | undefined;
                const duration = (response as Record<string, unknown>).duration as number | undefined;
                const output = (response as Record<string, unknown>).output as string | undefined;
                const errorMsg = (response as Record<string, unknown>).error as string | undefined;
                const exitCode = (response as Record<string, unknown>).exit_code as number | undefined;

                const success = status === "success" || status === "passed" || (exitCode === 0 && !errorMsg);

                // Build detailed output summary
                const parts: string[] = [];
                if (filesChecked != null && filesChecked > 0) {
                  parts.push(`Files checked: ${filesChecked}`);
                }
                if (issuesFound != null) {
                  parts.push(`Issues found: ${issuesFound}`);
                }
                if (issuesFixed != null && issuesFixed > 0) {
                  parts.push(`Issues fixed: ${issuesFixed}`);
                }
                if (duration != null) {
                  parts.push(`Duration: ${duration}ms`);
                }

                const summary = parts.length > 0 ? parts.join(" | ") + "\n\n" : "";

                return {
                  success,
                  output: summary + (output || ""),
                  error: errorMsg || undefined,
                  duration_ms: duration,
                  exit_code: exitCode,
                  issues_found: issuesFound,
                  issues_fixed: issuesFixed,
                  files_checked: filesChecked,
                } as ExecutionResult;
              } catch (err) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : "Execution failed",
                } as ExecutionResult;
              }
            }}
            runLabel="Run Check"
            disabled={isNew}
          />
        )}

        {/* AI Workspace Scanner */}
        <AiWorkspaceScanner onAcceptChecks={onAcceptAiChecks} />

        {/* AI Generator */}
        <AiGeneratorPanel
          title="Generate with AI"
          accentColor="purple"
          templates={[
            { label: "Linter", prompt: "Create an ESLint check for a TypeScript project" },
            { label: "Formatter", prompt: "Create a Prettier format check" },
            { label: "Type Check", prompt: "Create a TypeScript type-checking check" },
          ]}
          placeholder="Describe the check you want to generate..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Check Group List Item
// =============================================================================

function CheckGroupListItem({ item, isSelected }: { item: CheckGroupItem; isSelected: boolean }) {
  const checkCount = item.check_ids?.length || 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-teal-400 shrink-0" />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <Badge variant="secondary" className="text-[10px] px-1.5 bg-teal-500/10 text-teal-400 border-teal-500/30">
          {checkCount} {checkCount === 1 ? "check" : "checks"}
        </Badge>
        {item.run_in_parallel && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-purple-500/10 text-purple-400 border-purple-500/30">
            Parallel
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}

// =============================================================================
// Check Group Editor
// =============================================================================

interface CheckGroupEditorProps {
  item: CheckGroupItem;
  form: CheckGroupForm;
  setForm: (form: CheckGroupForm | ((prev: CheckGroupForm) => CheckGroupForm)) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  checksMap: Map<string, { id: string; name: string; description?: string | null; check_type: string }>;
}

function CheckGroupEditor({ item, form, setForm, isDirty, isNew, isSaving, onSave, onDelete, checksMap }: CheckGroupEditorProps) {
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  const updateField = <K extends keyof CheckGroupForm>(field: K, value: CheckGroupForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAssignChecks = (checkIds: string[]) => {
    updateField("check_ids", checkIds);
    setAssignDialogOpen(false);
  };

  const handleRemoveCheck = (checkId: string) => {
    updateField("check_ids", form.check_ids.filter((id) => id !== checkId));
  };

  const handleMoveCheck = (index: number, direction: "up" | "down") => {
    const newIds = [...form.check_ids];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newIds.length) return;
    const temp = newIds[index]!;
    newIds[index] = newIds[targetIndex]!;
    newIds[targetIndex] = temp;
    updateField("check_ids", newIds);
  };

  const assignedChecks = form.check_ids
    .map((id) => checksMap.get(id))
    .filter(Boolean);

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
        nameplaceholder="Check group name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this check group does..."
            className="min-h-[60px] text-sm bg-muted border-border resize-none"
          />
        </div>

        {/* Checks */}
        <EditorSection title="Checks" defaultOpen={true}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {form.check_ids.length} {form.check_ids.length === 1 ? "check" : "checks"} assigned
              </span>
              <button
                onClick={() => setAssignDialogOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 rounded border border-teal-500/30 transition-colors"
              >
                <Plus className="size-3.5" />
                Assign Checks
              </button>
            </div>

            {assignedChecks.length > 0 ? (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {assignedChecks.map((check, index) => check && (
                  <div
                    key={check.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-muted rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleMoveCheck(index, "up")}
                        disabled={index === 0}
                        className="p-0.5 text-muted-foreground hover:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveCheck(index, "down")}
                        disabled={index === assignedChecks.length - 1}
                        className="p-0.5 text-muted-foreground hover:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground truncate">{check.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 bg-green-500/10 text-green-400 border-green-500/30 shrink-0">
                          {check.check_type}
                        </Badge>
                      </div>
                      {check.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{check.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveCheck(check.id)}
                      className="shrink-0 p-1 text-muted-foreground hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 bg-muted/50 border border-border rounded-lg text-center">
                <Layers className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No checks assigned yet</p>
                <p className="text-xs text-muted-foreground mt-1">Click &quot;Assign Checks&quot; to add checks</p>
              </div>
            )}
          </div>
        </EditorSection>

        {/* Settings */}
        <EditorSection title="Settings" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
              <div>
                <span className="text-sm text-muted-foreground block">Stop on Failure</span>
                <span className="text-xs text-muted-foreground">Stop executing when a check fails</span>
              </div>
              <input
                type="checkbox"
                checked={form.stop_on_failure}
                onChange={(e) => updateField("stop_on_failure", e.target.checked)}
                className="w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
              <div>
                <span className="text-sm text-muted-foreground block">Run in Parallel</span>
                <span className="text-xs text-muted-foreground">Execute all checks simultaneously</span>
              </div>
              <input
                type="checkbox"
                checked={form.run_in_parallel}
                onChange={(e) => updateField("run_in_parallel", e.target.checked)}
                className="w-4 h-4"
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

        {/* Execution */}
        {!isNew && (
          <ExecutionPanel
            onRun={async () => {
              try {
                const response = await runnerApi.runCheckGroup(item.id);
                return {
                  success: response.status === "success",
                  output: response.output || `${response.passed_checks}/${response.total_checks} checks passed`,
                  error: response.error || undefined,
                  duration_ms: response.duration,
                } as ExecutionResult;
              } catch (err) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : "Execution failed",
                } as ExecutionResult;
              }
            }}
            runLabel="Run Check Group"
            disabled={isNew || form.check_ids.length === 0}
          />
        )}
      </div>

      <AssignChecksDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        groupId={item?.id || ""}
        selectedCheckIds={form.check_ids}
        onSave={handleAssignChecks}
      />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

function ChecksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(
    searchParams.get("tab") === "groups" ? "groups" : "checks"
  );
  const [showCreationDialog, setShowCreationDialog] = useState(false);
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);

  // --- Checks hooks (always called) ---
  const checksListQuery = useChecksList();
  const createCheckMutation = useCreateCheck();
  const updateCheckMutation = useUpdateCheck();
  const deleteCheckMutation = useDeleteCheck();

  const checksBuilder = useBuilderPage<CheckItem, CheckForm, CheckCreate>({
    items: checksListQuery.data,
    isLoading: checksListQuery.isLoading,
    error: checksListQuery.error,
    isOffline: false,
    toForm: toCheckForm,
    defaultForm: defaultCheckForm,
    toPayload: toCheckPayload,
    onCreate: (data) => createCheckMutation.mutateAsync(data),
    onUpdate: (id, data) => updateCheckMutation.mutateAsync({ id, data }),
    onDelete: (id) => deleteCheckMutation.mutateAsync(id),
    refetch: () => checksListQuery.refetch(),
  });

  // --- Check Groups hooks (always called) ---
  const groupsListQuery = useCheckGroupsList();
  const createGroupMutation = useCreateCheckGroup();
  const updateGroupMutation = useUpdateCheckGroup();
  const deleteGroupMutation = useDeleteCheckGroup();

  const groupsBuilder = useBuilderPage<CheckGroupItem, CheckGroupForm, CheckGroupCreate>({
    items: groupsListQuery.data,
    isLoading: groupsListQuery.isLoading,
    error: groupsListQuery.error,
    isOffline: false,
    toForm: toGroupForm,
    defaultForm: defaultGroupForm,
    toPayload: toGroupPayload,
    onCreate: (data) => createGroupMutation.mutateAsync(data),
    onUpdate: (id, data) => updateGroupMutation.mutateAsync({ id, data }),
    onDelete: (id) => deleteGroupMutation.mutateAsync(id),
    refetch: () => groupsListQuery.refetch(),
  });

  const checksMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; description?: string | null; check_type: string }>();
    (checksListQuery.data || []).forEach((check) => map.set(check.id, check));
    return map;
  }, [checksListQuery.data]);

  // --- Tab switching ---
  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      const url = tab === "groups" ? "/build/checks?tab=groups" : "/build/checks";
      router.replace(url);
    },
    [router]
  );

  // --- Check creation dialog handler ---
  const handleCreationDialogCreate = (checkType: string, tool: string) => {
    const defaults = getCheckDefaults(checkType, tool);
    checksBuilder.onNew();
    checksBuilder.setForm((prev) => ({
      ...prev,
      name: defaults.name,
      check_type: checkType,
      tool,
      command: defaults.command,
      description: defaults.description,
      auto_fix: defaults.auto_fix,
    }));
  };

  const handleAcceptAiChecks = async (checks: SuggestedCheck[]) => {
    for (const check of checks) {
      try {
        await createCheckMutation.mutateAsync({
          name: check.name,
          check_type: check.check_type,
          tool: check.tool,
          command: check.command,
          description: check.description || null,
          auto_fix: false,
          fail_on_warning: false,
          is_critical: false,
          timeout_seconds: 300,
          enabled: true,
          tags: ["ai-generated"],
        } as Parameters<typeof createCheckMutation.mutateAsync>[0]);
      } catch {
        // Continue creating the rest even if one fails
      }
    }
    await checksListQuery.refetch();
  };

  // --- Check Groups list actions ---
  const renderGroupListActions = useCallback(
    (item: CheckGroupItem) => (
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
        title="Insert into Workflow"
        onClick={() => {
          setAddToWorkflowStep({
            type: "command",
            name: item.name,
            check_group_id: item.id,
          });
        }}
      >
        <Workflow className="size-3.5" />
      </Button>
    ),
    []
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0">
        <TabButton
          active={activeTab === "checks"}
          onClick={() => handleTabChange("checks")}
          icon={CheckCircle2}
          label="Checks"
          count={checksListQuery.data?.length}
        />
        <TabButton
          active={activeTab === "groups"}
          onClick={() => handleTabChange("groups")}
          icon={Layers}
          label="Check Groups"
          count={groupsListQuery.data?.length}
        />
      </div>

      {/* Active panel */}
      {activeTab === "checks" ? (
        <>
          <BuilderLayout<CheckItem>
            title="Checks"
            icon={CheckCircle2}
            iconColor="text-green-400"
            accentColor="green"
            items={checksBuilder.items}
            isLoading={checksBuilder.isLoading}
            error={checksBuilder.error}
            isOffline={checksBuilder.isOffline}
            selectedItem={checksBuilder.selectedItem}
            onSelect={checksBuilder.onSelect}
            onNew={() => setShowCreationDialog(true)}
            onDelete={checksBuilder.onDelete}
            refetch={checksBuilder.refetch}
            emptyIcon={CheckCircle2}
            emptyTitle="No checks yet"
            emptyDescription="Create verification checks for linting, formatting, and more"
            itemLabel="check"
            searchPlaceholder="Search checks..."
            initialSelectedId={checksBuilder.initialSelectedId}
            renderListItem={(item, isSelected) => (
              <CheckListItem item={item} isSelected={isSelected} />
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
                    check_type: item.check_type as import("@/types/unified-workflow").CheckType,
                    check_id: item.id,
                    command: item.command ?? undefined,
                  });
                }}
              >
                <Workflow className="size-3.5" />
              </Button>
            )}
            renderEditor={(item) => (
              <CheckEditor
                item={item}
                form={checksBuilder.form}
                setForm={checksBuilder.setForm}
                isDirty={checksBuilder.isDirty}
                isNew={checksBuilder.isNew}
                isSaving={checksBuilder.isSaving}
                onSave={checksBuilder.save}
                onDelete={checksBuilder.deleteSelected}
                onAcceptAiChecks={handleAcceptAiChecks}
              />
            )}
          />

          <CheckCreationDialog
            open={showCreationDialog}
            onOpenChange={setShowCreationDialog}
            onCreateCheck={handleCreationDialogCreate}
          />
        </>
      ) : (
        <BuilderLayout<CheckGroupItem>
          title="Check Groups"
          icon={Layers}
          iconColor="text-teal-400"
          accentColor="teal"
          items={groupsBuilder.items}
          isLoading={groupsBuilder.isLoading}
          error={groupsBuilder.error}
          isOffline={groupsBuilder.isOffline}
          selectedItem={groupsBuilder.selectedItem}
          onSelect={groupsBuilder.onSelect}
          onNew={groupsBuilder.onNew}
          onDelete={groupsBuilder.onDelete}
          refetch={groupsBuilder.refetch}
          emptyIcon={Layers}
          emptyTitle="No check groups yet"
          emptyDescription="Create organized collections of checks"
          itemLabel="check group"
          searchPlaceholder="Search check groups..."
          initialSelectedId={groupsBuilder.initialSelectedId}
          renderListItem={(item, isSelected) => (
            <CheckGroupListItem item={item} isSelected={isSelected} />
          )}
          renderListActions={renderGroupListActions}
          renderEditor={(item) => (
            <CheckGroupEditor
              item={item}
              form={groupsBuilder.form}
              setForm={groupsBuilder.setForm}
              isDirty={groupsBuilder.isDirty}
              isNew={groupsBuilder.isNew}
              isSaving={groupsBuilder.isSaving}
              onSave={groupsBuilder.save}
              onDelete={groupsBuilder.deleteSelected}
              checksMap={checksMap}
            />
          )}
        />
      )}

      <AddToWorkflowDialog
        open={addToWorkflowStep !== null}
        onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
        stepData={addToWorkflowStep ?? {}}
      />
    </div>
  );
}

export default function ChecksPage() {
  return (
    <Suspense fallback={null}>
      <ChecksPageContent />
    </Suspense>
  );
}
