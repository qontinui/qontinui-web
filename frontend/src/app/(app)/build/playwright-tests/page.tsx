"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileCode,
  Code2,
  Settings,
  MessageSquare,
  Tags,
  Eye,
  Code,
  Camera,
  Download,
  Upload,
  ShieldCheck,
  RefreshCw,
  AtSign,
  X,
  Loader2,
  AlertTriangle,
  Workflow,
  FileText,
} from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import {
  usePlaywrightTestsList,
  useCreatePlaywrightTest,
  useUpdatePlaywrightTest,
  useDeletePlaywrightTest,
  useDuplicatePlaywrightTest,
  useRunnerPromptSnippetsList,
} from "@/components/builders/hooks/useRunnerEntity";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import { EditorHeader, EditorSection, ExecutionPanel, MonacoField, type ExecutionResult } from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import { PromptSnippetManager } from "@/components/builders/PromptSnippetManager";
import type { UnifiedStep } from "@/types/unified-workflow";
import type { PlaywrightScript, PromptSnippet } from "@/lib/runner/types/library";

// =============================================================================
// Form State
// =============================================================================

type ViewMode = "description" | "code";

interface ScriptForm {
  name: string;
  description: string;
  script_content: string;
  target_url: string;
  ai_instructions: string;
  category: string;
  tags: string[];
  timeout_seconds: number;
  display_mode: string;
  browser: string;
  screenshot_on_failure: boolean;
  trace_enabled: boolean;
  video_enabled: boolean;
}

const DEFAULT_SCRIPT_CONTENT = `import { test, expect } from '@playwright/test';

test('example test', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
`;

// =============================================================================
// Conversion Utilities
// =============================================================================

function toForm(item: PlaywrightScript): ScriptForm {
  return {
    name: item.name ?? "",
    description: item.description ?? "",
    script_content: item.script_content ?? DEFAULT_SCRIPT_CONTENT,
    target_url: item.target_url ?? "",
    ai_instructions: item.ai_instructions ?? "",
    category: item.category ?? "",
    tags: item.tags ?? [],
    timeout_seconds: item.timeout_seconds ?? 30,
    display_mode: item.display_mode ?? "headless",
    browser: item.browser ?? "chromium",
    screenshot_on_failure: true,
    trace_enabled: false,
    video_enabled: false,
  };
}

function defaultForm(): ScriptForm {
  return {
    name: "",
    description: "",
    script_content: DEFAULT_SCRIPT_CONTENT,
    target_url: "",
    ai_instructions: "",
    category: "",
    tags: [],
    timeout_seconds: 30,
    display_mode: "headless",
    browser: "chromium",
    screenshot_on_failure: true,
    trace_enabled: false,
    video_enabled: false,
  };
}

function toPayload(form: ScriptForm): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description || undefined,
    script_content: form.script_content,
    target_url: form.target_url || undefined,
    ai_instructions: form.ai_instructions || undefined,
    category: form.category || undefined,
    tags: form.tags.length > 0 ? form.tags : undefined,
    timeout_seconds: form.timeout_seconds,
    display_mode: form.display_mode,
    browser: form.browser,
  };
}

// =============================================================================
// localStorage Draft Utilities
// =============================================================================

const DRAFT_KEY_PREFIX = "script-draft-";

function getDraftKey(id: string | undefined): string {
  return `${DRAFT_KEY_PREFIX}${id ?? "new"}`;
}

function saveDraft(id: string | undefined, form: ScriptForm): void {
  try {
    localStorage.setItem(getDraftKey(id), JSON.stringify(form));
  } catch {
    // localStorage full or unavailable
  }
}

function loadDraft(id: string | undefined): ScriptForm | null {
  try {
    const raw = localStorage.getItem(getDraftKey(id));
    if (raw) return JSON.parse(raw) as ScriptForm;
  } catch {
    // parse error
  }
  return null;
}

function clearDraft(id: string | undefined): void {
  try {
    localStorage.removeItem(getDraftKey(id));
  } catch {
    // ignore
  }
}

// =============================================================================
// Main Component
// =============================================================================

export default function PlaywrightTestsPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false);
  const listQuery = usePlaywrightTestsList();
  const createMutation = useCreatePlaywrightTest();
  const updateMutation = useUpdatePlaywrightTest();
  const deleteMutation = useDeletePlaywrightTest();
  const duplicateMutation = useDuplicatePlaywrightTest();

  // Detect offline state
  const isOffline =
    !listQuery.isLoading && listQuery.data === undefined && listQuery.error != null;

  const builderState = useBuilderPage<PlaywrightScript, ScriptForm>({
    items: listQuery.data,
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    isOffline,
    toForm,
    defaultForm,
    toPayload,
    onCreate: (data) => createMutation.mutateAsync(data as Partial<PlaywrightScript>),
    onUpdate: (id, data) =>
      updateMutation.mutateAsync({ id, data: data as Partial<PlaywrightScript> }),
    onDelete: (id) => deleteMutation.mutateAsync(id),
    refetch: () => listQuery.refetch(),
  });

  const handleDuplicate = async () => {
    if (!builderState.selectedItem || builderState.isNew) return;
    const newName = `${builderState.selectedItem.name} (Copy)`;
    await duplicateMutation.mutateAsync({
      id: builderState.selectedItem.id,
      newName,
    });
    await builderState.refetch();
  };

  const renderListActions = useCallback(
    (item: PlaywrightScript) => (
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
        title="Insert into Workflow"
        onClick={() => {
          setAddToWorkflowStep({
            type: "command",
            name: item.name,
            test_type: "playwright",
            script_id: item.id,
            target_url: item.target_url,
          });
        }}
      >
        <Workflow className="size-3.5" />
      </Button>
    ),
    []
  );

  return (
    <>
    <BuilderLayout
      title="Playwright Tests"
      icon={FileCode}
      iconColor="text-blue-400"
      accentColor="blue"
      items={builderState.items}
      isLoading={builderState.isLoading}
      error={builderState.error}
      isOffline={builderState.isOffline}
      selectedItem={builderState.selectedItem}
      onSelect={builderState.onSelect}
      onNew={builderState.onNew}
      onDelete={builderState.onDelete}
      refetch={builderState.refetch}
      renderListItem={(item, isSelected) => (
        <ScriptListItem item={item} isSelected={isSelected} />
      )}
      renderListActions={renderListActions}
      renderEditor={(item) => (
        <ScriptEditor
          item={item}
          form={builderState.form}
          setForm={builderState.setForm}
          isDirty={builderState.isDirty}
          isNew={builderState.isNew}
          isSaving={builderState.isSaving}
          onSave={() => {
            builderState.save();
            clearDraft(item.id);
          }}
          onDelete={builderState.deleteSelected}
          onDuplicate={handleDuplicate}
          onOpenSnippetManager={() => setSnippetManagerOpen(true)}
        />
      )}
      emptyIcon={FileCode}
      emptyTitle="No playwright tests yet"
      emptyDescription="Create a Playwright test to get started"
      itemLabel="playwright test"
      searchPlaceholder="Search playwright tests..."
      initialSelectedId={builderState.initialSelectedId}
    />

    <AddToWorkflowDialog
      open={addToWorkflowStep !== null}
      onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
      stepData={addToWorkflowStep ?? {}}
    />

    <PromptSnippetManager
      open={snippetManagerOpen}
      onOpenChange={setSnippetManagerOpen}
    />
    </>
  );
}

// =============================================================================
// List Item Renderer
// =============================================================================

function ScriptListItem({
  item,
  isSelected,
}: {
  item: PlaywrightScript;
  isSelected: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <Code2
          className={`size-4 mt-0.5 shrink-0 ${isSelected ? "text-blue-400" : "text-muted-foreground"}`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-foreground truncate">
            {item.name}
          </div>
          {item.category && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 mt-1 bg-blue-500/10 text-blue-400 border-blue-500/30"
            >
              {item.category}
            </Badge>
          )}
        </div>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
          {item.description}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Prompt Snippet Mention Dropdown
// =============================================================================

interface PromptSnippetMentionProps {
  snippets: PromptSnippet[];
  query: string;
  onSelect: (snippet: PromptSnippet) => void;
  onClose: () => void;
}

function PromptSnippetMentionDropdown({
  snippets,
  query,
  onSelect,
  onClose,
}: PromptSnippetMentionProps) {
  const filtered = snippets.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <div className="absolute z-50 mt-1 w-64 bg-muted border border-border rounded-lg shadow-lg p-2">
        <p className="text-xs text-muted-foreground px-2 py-1">No prompt snippets found</p>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-muted-foreground px-2 py-1"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="absolute z-50 mt-1 w-64 max-h-48 overflow-y-auto bg-muted border border-border rounded-lg shadow-lg">
      {filtered.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s)}
          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg"
        >
          <div className="font-medium truncate">{s.name}</div>
          {s.category && (
            <div className="text-xs text-muted-foreground">{s.category}</div>
          )}
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

interface ScriptEditorProps {
  item: PlaywrightScript;
  form: ScriptForm;
  setForm: (form: ScriptForm) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpenSnippetManager: () => void;
}

function ScriptEditor({
  item,
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
  onDuplicate,
  onOpenSnippetManager,
}: ScriptEditorProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Feature 1: View mode toggle
  const [viewMode, setViewMode] = useState<ViewMode>("description");

  // Feature 3: Prompt snippet mention state
  const promptSnippetsQuery = useRunnerPromptSnippetsList();
  const [showSnippetDropdown, setShowSnippetDropdown] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [snippetTarget, setSnippetTarget] = useState<
    "description" | "ai_instructions"
  >("description");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const aiInstructionsRef = useRef<HTMLTextAreaElement>(null);

  // Feature 5: Coverage validation
  const [coverageWarnings, setCoverageWarnings] = useState<string[]>([]);
  const [isValidatingCoverage, setIsValidatingCoverage] = useState(false);

  // Feature 6: Auto-save draft
  const [hasDraft, setHasDraft] = useState(false);
  const draftCheckDone = useRef(false);

  // Feature 7: Description regeneration
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Feature 8: Auto-refine loop
  const [isAutoRefining, setIsAutoRefining] = useState(false);
  const [autoRefineIteration, setAutoRefineIteration] = useState(0);
  const [autoRefineMaxIterations, setAutoRefineMaxIterations] = useState(() => {
    try {
      const saved = localStorage.getItem("qontinui-autorefine-max-iterations");
      return saved ? parseInt(saved, 10) : 5;
    } catch { return 5; }
  });
  const [autoRefineLog, setAutoRefineLog] = useState<string[]>([]);
  const [autoRefineUserHint, setAutoRefineUserHint] = useState("");
  const autoRefineAbortRef = useRef(false);
  const [videoAfterIterations, setVideoAfterIterations] = useState(() => {
    try {
      const saved = localStorage.getItem("qontinui-autorefine-video-after-iterations");
      return saved ? parseInt(saved, 10) : 3;
    } catch { return 3; }
  });

  // Check for existing draft on mount / item change
  useEffect(() => {
    if (!draftCheckDone.current) {
      const draft = loadDraft(item.id);
      if (draft && JSON.stringify(toForm(item)) !== JSON.stringify(draft)) {
        setHasDraft(true);
      }
      draftCheckDone.current = true;
    }
    return () => {
      draftCheckDone.current = false;
    };
  }, [item]);

  // Auto-save draft on form change (debounced)
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      saveDraft(item.id, form);
      setHasDraft(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, [form, isDirty, item.id]);

  const updateField = <K extends keyof ScriptForm>(field: K, value: ScriptForm[K]) => {
    setForm({ ...form, [field]: value });
  };

  const handleDelete = async () => {
    clearDraft(item.id);
    await onDelete();
    setDeleteDialogOpen(false);
  };

  const handleDiscardDraft = () => {
    clearDraft(item.id);
    setForm(toForm(item));
    setHasDraft(false);
  };

  const handleRestoreDraft = () => {
    const draft = loadDraft(item.id);
    if (draft) {
      setForm(draft);
    }
    setHasDraft(false);
  };

  // Feature 3: Handle @-mention in textareas
  const handleTextareaKeyUp = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    target: "description" | "ai_instructions"
  ) => {
    const textarea = e.currentTarget;
    const value = textarea.value;
    const cursorPos = textarea.selectionStart;

    // Find the last @ before cursor
    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex >= 0) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      // Only show dropdown if @ is at start or preceded by whitespace, and no space in query
      const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] ?? " " : " ";
      if (/\s/.test(charBefore) && !/\s/.test(textAfterAt)) {
        setSnippetQuery(textAfterAt);
        setSnippetTarget(target);
        setShowSnippetDropdown(true);
        return;
      }
    }

    setShowSnippetDropdown(false);
  };

  const handleSnippetSelect = (snippet: PromptSnippet) => {
    const ref =
      snippetTarget === "description" ? descriptionRef : aiInstructionsRef;
    const fieldName =
      snippetTarget === "description" ? "description" : "ai_instructions";
    const currentValue = form[fieldName];
    const textarea = ref.current;

    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = currentValue.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex >= 0) {
        const newValue =
          currentValue.substring(0, lastAtIndex) +
          `@${snippet.name}` +
          currentValue.substring(cursorPos);
        updateField(fieldName, newValue);
      }
    } else {
      updateField(fieldName, currentValue + `@${snippet.name}`);
    }

    setShowSnippetDropdown(false);
    setSnippetQuery("");
  };

  // Feature 4: Export
  const handleExport = () => {
    const data = JSON.stringify(toPayload(form), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.name || "script"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Feature 4: Import
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      setForm({
        ...form,
        name: data.name ?? form.name,
        description: data.description ?? form.description,
        script_content: data.script_content ?? form.script_content,
        target_url: data.target_url ?? form.target_url,
        ai_instructions: data.ai_instructions ?? form.ai_instructions,
        category: data.category ?? form.category,
        tags: data.tags ?? form.tags,
        timeout_seconds: data.timeout_seconds ?? form.timeout_seconds,
        display_mode: data.display_mode ?? form.display_mode,
        browser: data.browser ?? form.browser,
      });
    } catch {
      // Invalid JSON - silently ignore
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Feature 5: Validate coverage
  const handleValidateCoverage = async () => {
    if (!form.description.trim() || !form.script_content.trim()) {
      setCoverageWarnings([
        "Both description and script content are required for coverage validation.",
      ]);
      return;
    }

    setIsValidatingCoverage(true);
    setCoverageWarnings([]);

    try {
      const result = await runnerApi.aiGenerateTest(
        `Analyze this Playwright test script and verify it implements ALL functionality from the description.

## Test Description (What the script SHOULD do)
${form.description}

## Generated Script Code (What the script ACTUALLY does)
\`\`\`typescript
${form.script_content}
\`\`\`

## Task
Compare the description with the code and identify ANY missing functionality.

## Output Format
If the script implements ALL requirements from the description, respond with exactly:
COVERAGE: COMPLETE

If there are missing requirements, respond with:
COVERAGE: INCOMPLETE
MISSING:
- [First missing functionality]
- [Second missing functionality]
- [etc.]

Be thorough - check each action, assertion, and behavior mentioned in the description.`,
        "playwright_cdp"
      );

      if (result.success && result.data) {
        const output = String(
          (result.data as Record<string, unknown>).output ??
            (result.data as Record<string, unknown>).content ??
            JSON.stringify(result.data)
        );

        if (output.includes("COVERAGE: COMPLETE")) {
          setCoverageWarnings([]);
        } else {
          const missingMatch = output.match(
            /MISSING:\s*([\s\S]*?)(?:$|(?=\n\n))/i
          );
          if (missingMatch) {
            const items = (missingMatch[1] ?? "")
              .split("\n")
              .map((line: string) => line.replace(/^[-*]\s*/, "").trim())
              .filter((line: string) => line.length > 0);
            setCoverageWarnings(
              items.length > 0
                ? items
                : ["Some requirements may not be fully covered."]
            );
          } else if (output.includes("COVERAGE: INCOMPLETE")) {
            setCoverageWarnings([
              "Some requirements from the description may not be implemented.",
            ]);
          } else {
            setCoverageWarnings([]);
          }
        }
      } else {
        setCoverageWarnings(["Coverage validation returned no result."]);
      }
    } catch (err) {
      setCoverageWarnings([
        `Coverage validation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      ]);
    } finally {
      setIsValidatingCoverage(false);
    }
  };

  // Feature 7: Regenerate description from code
  const handleRegenerateDescription = async () => {
    if (!form.script_content.trim()) return;

    setIsRegenerating(true);

    try {
      const result = await runnerApi.aiGenerateTest(
        `Analyze the following Playwright test script and generate a concise, human-readable description of what it does. Focus on the user-facing behavior being tested, not the implementation details.

\`\`\`typescript
${form.script_content}
\`\`\`

Respond with ONLY the description text, no code blocks, no prefixes, no formatting. Just plain text describing what the test does.`,
        "playwright_cdp"
      );

      if (result.success && result.data) {
        const output = String(
          (result.data as Record<string, unknown>).output ??
            (result.data as Record<string, unknown>).content ??
            ""
        );
        if (output.trim()) {
          // Clean up the output - strip common wrappings
          const cleaned = output
            .replace(/^["']|["']$/g, "")
            .replace(/^Description:\s*/i, "")
            .trim();
          updateField("description", cleaned);
        }
      }
    } catch {
      // Silently fail - user can see the description didn't change
    } finally {
      setIsRegenerating(false);
    }
  };

  // Feature 8: Auto-refine loop
  const runAutoRefine = async () => {
    if (isNew || !item.id) return;

    setIsAutoRefining(true);
    setAutoRefineIteration(0);
    setAutoRefineLog([]);
    autoRefineAbortRef.current = false;

    let iteration = 0;

    while (iteration < autoRefineMaxIterations && !autoRefineAbortRef.current) {
      iteration++;
      setAutoRefineIteration(iteration);
      setAutoRefineLog((prev) => [...prev, `--- Iteration ${iteration} ---`]);

      try {
        // 1. Save current script
        onSave();
        await new Promise((r) => setTimeout(r, 500));

        // 2. Run test
        setAutoRefineLog((prev) => [...prev, "Running test..."]);
        const runResult = await runnerApi.runPlaywrightTest(item.id);
        setAutoRefineLog((prev) => [...prev, `Task run: ${runResult.task_run_id}`]);

        // Wait for result - poll task run status
        let attempts = 0;
        let taskResult: Record<string, unknown> | null = null;
        while (attempts < 60 && !autoRefineAbortRef.current) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const statusRes = await fetch(`http://localhost:9876/task-runs/${runResult.task_run_id}`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              const status = statusData.status ?? statusData.data?.status;
              if (status === "completed" || status === "failed" || status === "stopped") {
                taskResult = statusData;
                break;
              }
            }
          } catch { /* continue polling */ }
          attempts++;
        }

        if (autoRefineAbortRef.current) break;

        if (!taskResult) {
          setAutoRefineLog((prev) => [...prev, "Timed out waiting for test result"]);
          break;
        }

        // 3. Check if passed
        const output = String(
          (taskResult as Record<string, unknown>).output_log ??
          (taskResult as Record<string, unknown>).output ??
          JSON.stringify(taskResult)
        );

        const passed = output.includes("passed") && !output.includes("failed");
        if (passed) {
          setAutoRefineLog((prev) => [...prev, "All tests passed!"]);
          break;
        }

        setAutoRefineLog((prev) => [...prev, "Tests failed. Requesting AI refinement..."]);

        // 4. Call AI to refine
        const refinementPrompt = `Refine this Playwright test script. The tests failed.

## Current Script
\`\`\`typescript
${form.script_content}
\`\`\`

## Test Output
${output.slice(-3000)}

## Target URL
${form.target_url || "Not specified"}

${autoRefineUserHint.trim() ? `## User Hint\n${autoRefineUserHint}\n` : ""}
${form.ai_instructions.trim() ? `## AI Instructions\n${form.ai_instructions}\n` : ""}

## Task
Fix the failing tests. Return ONLY the complete updated TypeScript test script inside a single code block. Do not include explanations outside the code block.`;

        const aiResult = await runnerApi.aiGenerateTest(refinementPrompt, "playwright_cdp");

        if (aiResult.success && aiResult.data) {
          const aiOutput = String(
            (aiResult.data as Record<string, unknown>).output ??
            (aiResult.data as Record<string, unknown>).content ??
            ""
          );

          // Extract code from response
          const codeMatch = aiOutput.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/);
          if (codeMatch?.[1]) {
            updateField("script_content", codeMatch[1].trim());
            setAutoRefineLog((prev) => [...prev, "Script updated by AI"]);
          } else {
            setAutoRefineLog((prev) => [...prev, "AI response did not contain a code block"]);
            break;
          }
        } else {
          setAutoRefineLog((prev) => [...prev, "AI refinement failed"]);
          break;
        }
      } catch (e) {
        setAutoRefineLog((prev) => [
          ...prev,
          `Error: ${e instanceof Error ? e.message : "Unknown error"}`,
        ]);
        break;
      }
    }

    setIsAutoRefining(false);
  };

  const stopAutoRefine = () => {
    autoRefineAbortRef.current = true;
    setIsAutoRefining(false);
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
      {/* Header */}
      <EditorHeader
        name={form.name}
        onNameChange={(name) => updateField("name", name)}
        onSave={onSave}
        onDelete={() => setDeleteDialogOpen(true)}
        onDuplicate={onDuplicate}
        isSaving={isSaving}
        isDirty={isDirty}
        isNew={isNew}
        nameplaceholder="Playwright test name..."
      >
        {/* Feature 4: Import/Export Buttons */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-muted-foreground"
          onClick={handleExport}
          title="Export as JSON"
        >
          <Download className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-muted-foreground"
          onClick={handleImport}
          title="Import from JSON"
        >
          <Upload className="size-3.5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />
      </EditorHeader>

      {/* Feature 6: Draft Restore Banner */}
      {hasDraft && !isDirty && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-sm">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <span className="flex-1 text-amber-300 text-xs">
            You have an unsaved draft for this playwright test.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-amber-400 hover:text-amber-300"
            onClick={handleRestoreDraft}
          >
            Restore Draft
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-muted-foreground"
            onClick={handleDiscardDraft}
          >
            Discard
          </Button>
        </div>
      )}

      {/* Feature 1: View Mode Toggle */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1">
        <div className="inline-flex items-center rounded-lg bg-muted border border-border p-0.5">
          <button
            onClick={() => setViewMode("description")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === "description"
                ? "bg-blue-500/20 text-blue-400 shadow-sm"
                : "text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            <Eye className="size-3.5" />
            Description
          </button>
          <button
            onClick={() => setViewMode("code")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === "code"
                ? "bg-blue-500/20 text-blue-400 shadow-sm"
                : "text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            <Code className="size-3.5" />
            Code
          </button>
        </div>

        {/* Manage Snippets */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 ml-auto text-xs text-indigo-400 hover:text-indigo-300 gap-1.5"
          onClick={onOpenSnippetManager}
          title="Manage prompt snippets"
        >
          <FileText className="size-3.5" />
          Manage Snippets
        </Button>

        {/* Feature 5: Validate Coverage Button */}
        {!isNew && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-muted-foreground gap-1.5"
            onClick={handleValidateCoverage}
            disabled={isValidatingCoverage}
            title="Validate that code covers all requirements from description"
          >
            {isValidatingCoverage ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            Validate Coverage
          </Button>
        )}
      </div>

      {/* Feature 5: Coverage Warnings */}
      {coverageWarnings.length > 0 && (
        <div className="mx-4 mt-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">
              Coverage Gaps Found
            </span>
            <button
              onClick={() => setCoverageWarnings([])}
              className="ml-auto text-muted-foreground hover:text-muted-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ul className="space-y-1">
            {coverageWarnings.map((warning, i) => (
              <li key={i} className="text-xs text-amber-300/80 pl-6">
                - {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* View Mode: Description */}
        {viewMode === "description" && (
          <>
            {/* Description with Regeneration */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="description" className="text-xs text-muted-foreground">
                  Description
                </Label>
                {/* Feature 7: Regenerate Description button */}
                {form.script_content.trim() &&
                  form.script_content !== DEFAULT_SCRIPT_CONTENT && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-muted-foreground gap-1"
                      onClick={handleRegenerateDescription}
                      disabled={isRegenerating}
                      title="Regenerate description from code"
                    >
                      {isRegenerating ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      Regenerate from code
                    </Button>
                  )}

                {/* Feature 3: Insert Prompt Snippet Button */}
                <div className="relative ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-muted-foreground gap-1"
                    onClick={() => {
                      setSnippetTarget("description");
                      setSnippetQuery("");
                      setShowSnippetDropdown(!showSnippetDropdown);
                    }}
                    title="Insert prompt snippet reference"
                  >
                    <AtSign className="size-3" />
                    Snippet
                  </Button>
                  {showSnippetDropdown &&
                    snippetTarget === "description" &&
                    promptSnippetsQuery.data && (
                      <PromptSnippetMentionDropdown
                        snippets={promptSnippetsQuery.data}
                        query={snippetQuery}
                        onSelect={(s) => {
                          handleSnippetSelect(s);
                          setShowSnippetDropdown(false);
                        }}
                        onClose={() => setShowSnippetDropdown(false)}
                      />
                    )}
                </div>
              </div>
              <Textarea
                ref={descriptionRef}
                id="description"
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                onKeyUp={(e) => handleTextareaKeyUp(e, "description")}
                placeholder="What does this test do? Type @ to reference a prompt snippet."
                className="min-h-[80px] text-sm bg-muted border-border resize-none"
              />
            </div>

            {/* AI Instructions (in Description mode) */}
            <EditorSection
              title="AI Instructions"
              icon={MessageSquare}
              defaultOpen={!!form.ai_instructions}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="ai_instructions"
                    className="text-xs text-muted-foreground"
                  >
                    Instructions for AI-assisted execution
                  </Label>
                  {/* Prompt snippet insert for AI instructions */}
                  <div className="relative ml-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-muted-foreground gap-1"
                      onClick={() => {
                        setSnippetTarget("ai_instructions");
                        setSnippetQuery("");
                        setShowSnippetDropdown(!showSnippetDropdown);
                      }}
                      title="Insert prompt snippet reference"
                    >
                      <AtSign className="size-3" />
                      Snippet
                    </Button>
                    {showSnippetDropdown &&
                      snippetTarget === "ai_instructions" &&
                      promptSnippetsQuery.data && (
                        <PromptSnippetMentionDropdown
                          snippets={promptSnippetsQuery.data}
                          query={snippetQuery}
                          onSelect={(s) => {
                            handleSnippetSelect(s);
                            setShowSnippetDropdown(false);
                          }}
                          onClose={() => setShowSnippetDropdown(false)}
                        />
                      )}
                  </div>
                </div>
                <Textarea
                  ref={aiInstructionsRef}
                  id="ai_instructions"
                  value={form.ai_instructions}
                  onChange={(e) =>
                    updateField("ai_instructions", e.target.value)
                  }
                  onKeyUp={(e) => handleTextareaKeyUp(e, "ai_instructions")}
                  placeholder="Optional: Provide context or special instructions for AI automation. Type @ to reference a prompt snippet."
                  className="min-h-[80px] text-sm bg-muted border-border resize-none"
                />
              </div>
            </EditorSection>
          </>
        )}

        {/* View Mode: Code */}
        {viewMode === "code" && (
          <div className="space-y-1.5">
            <Label htmlFor="script" className="text-xs text-muted-foreground">
              Script Content
            </Label>
            <MonacoField
              value={form.script_content}
              onChange={(value) => updateField("script_content", value)}
              language="typescript"
              height="500px"
            />
          </div>
        )}

        {/* Configuration Section */}
        <EditorSection title="Configuration" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            {/* Target URL */}
            <div className="space-y-1.5">
              <Label htmlFor="target_url" className="text-xs text-muted-foreground">
                Target URL
              </Label>
              <Input
                id="target_url"
                value={form.target_url}
                onChange={(e) => updateField("target_url", e.target.value)}
                placeholder="https://example.com"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label htmlFor="category" className="text-xs text-muted-foreground">
                Category
              </Label>
              <Input
                id="category"
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
                placeholder="e.g., auth, forms, navigation"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>

            {/* Browser */}
            <div className="space-y-1.5">
              <Label htmlFor="browser" className="text-xs text-muted-foreground">
                Browser
              </Label>
              <Select
                value={form.browser}
                onValueChange={(value) => updateField("browser", value)}
              >
                <SelectTrigger
                  id="browser"
                  className="bg-muted border-border h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">Chromium</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="webkit">WebKit (Safari)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Display Mode */}
            <div className="space-y-1.5">
              <Label htmlFor="display_mode" className="text-xs text-muted-foreground">
                Display Mode
              </Label>
              <Select
                value={form.display_mode}
                onValueChange={(value) => updateField("display_mode", value)}
              >
                <SelectTrigger
                  id="display_mode"
                  className="bg-muted border-border h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="headless">Headless</SelectItem>
                  <SelectItem value="headed">Headed</SelectItem>
                  <SelectItem value="slow-mo">Slow Motion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Timeout */}
            <div className="space-y-1.5">
              <Label htmlFor="timeout" className="text-xs text-muted-foreground">
                Timeout (seconds)
              </Label>
              <Input
                id="timeout"
                type="number"
                value={form.timeout_seconds}
                onChange={(e) =>
                  updateField("timeout_seconds", parseInt(e.target.value, 10) || 30)
                }
                min={1}
                max={600}
                className="bg-muted border-border h-8 text-sm"
              />
            </div>
          </div>
        </EditorSection>

        {/* Feature 2: Visual Context Section */}
        <EditorSection title="Visual Context" icon={Camera} defaultOpen={false}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">
                  Screenshot on Failure
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Capture screenshot when a test fails
                </p>
              </div>
              <Switch
                checked={form.screenshot_on_failure}
                onCheckedChange={(checked) =>
                  updateField("screenshot_on_failure", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">
                  Trace Recording
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Record a trace for post-mortem debugging
                </p>
              </div>
              <Switch
                checked={form.trace_enabled}
                onCheckedChange={(checked) =>
                  updateField("trace_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">
                  Video Recording
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Record video of test execution
                </p>
              </div>
              <Switch
                checked={form.video_enabled}
                onCheckedChange={(checked) =>
                  updateField("video_enabled", checked)
                }
              />
            </div>

            {form.video_enabled && (
              <div className="pl-4 border-l-2 border-blue-500/20">
                <div className="flex items-center gap-2">
                  <Label className="text-[11px] text-muted-foreground whitespace-nowrap">
                    Enable video after iteration
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={videoAfterIterations}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 0;
                      setVideoAfterIterations(v);
                      try { localStorage.setItem("qontinui-autorefine-video-after-iterations", String(v)); } catch {}
                    }}
                    className="bg-muted border-border h-7 text-sm w-16"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Video recording starts after this many auto-refine iterations (0 = always record)
                </p>
              </div>
            )}
          </div>
        </EditorSection>

        {/* AI Instructions Section (shown when in Code view mode since Description view has it inline) */}
        {viewMode === "code" && (
          <EditorSection
            title="AI Instructions"
            icon={MessageSquare}
            defaultOpen={false}
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="ai_instructions_code"
                className="text-xs text-muted-foreground"
              >
                Instructions for AI-assisted execution
              </Label>
              <Textarea
                id="ai_instructions_code"
                value={form.ai_instructions}
                onChange={(e) =>
                  updateField("ai_instructions", e.target.value)
                }
                placeholder="Optional: Provide context or special instructions for AI automation"
                className="min-h-[80px] text-sm bg-muted border-border resize-none"
              />
            </div>
          </EditorSection>
        )}

        {/* Tags Section */}
        <EditorSection title="Tags" icon={Tags} defaultOpen={false}>
          <TagInput
            tags={form.tags}
            onChange={(tags) => updateField("tags", tags)}
            placeholder="Add tag..."
          />
        </EditorSection>

        {/* Execution Panel */}
        {!isNew && (
          <ExecutionPanel
            onRun={async () => {
              try {
                const result = await runnerApi.runPlaywrightTest(item.id);
                return {
                  success: true,
                  output: `Started task run: ${result.task_run_id}`,
                } as ExecutionResult;
              } catch (err) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : "Execution failed",
                } as ExecutionResult;
              }
            }}
            runLabel="Run Test"
            disabled={isNew}
          />
        )}

        {/* Feature 8: Auto-Refine Loop */}
        {!isNew && (
          <EditorSection title="AI Auto-Refine" icon={RefreshCw} defaultOpen={false}>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Iteratively run the test, capture failures, and use AI to refine the script until tests pass.
              </p>

              {/* Settings */}
              <div className="flex items-center gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Max Iterations</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={autoRefineMaxIterations}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 5;
                      setAutoRefineMaxIterations(v);
                      try { localStorage.setItem("qontinui-autorefine-max-iterations", String(v)); } catch {}
                    }}
                    className="bg-muted border-border h-7 text-sm w-20"
                    disabled={isAutoRefining}
                  />
                </div>
              </div>

              {/* User hint */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">User Hint (optional)</Label>
                <Textarea
                  value={autoRefineUserHint}
                  onChange={(e) => setAutoRefineUserHint(e.target.value)}
                  placeholder="Provide guidance for the AI during refinement..."
                  className="min-h-[50px] text-sm bg-muted border-border resize-none"
                  disabled={isAutoRefining}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                {isAutoRefining ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={stopAutoRefine}
                    className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                  >
                    <X className="size-3.5 mr-1" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={runAutoRefine}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={isAutoRefining}
                  >
                    <RefreshCw className="size-3.5 mr-1" />
                    Start Auto-Refine
                  </Button>
                )}
                {isAutoRefining && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="size-3 animate-spin" />
                    Iteration {autoRefineIteration} / {autoRefineMaxIterations}
                  </span>
                )}
              </div>

              {/* Log output */}
              {autoRefineLog.length > 0 && (
                <div className="bg-background border border-border rounded-lg p-2.5 max-h-48 overflow-y-auto font-mono text-[11px] text-muted-foreground space-y-0.5">
                  {autoRefineLog.map((line, i) => (
                    <div key={i} className={line.startsWith("---") ? "text-muted-foreground font-semibold mt-1" : ""}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </EditorSection>
        )}

        {/* AI Generator Panel */}
        <AiGeneratorPanel
          title="Generate with AI"
          accentColor="purple"
          templates={[
            {
              label: "Login Test",
              prompt:
                "Create a login test with username and password fields",
            },
            {
              label: "Form Validation",
              prompt: "Create a form validation test",
            },
            {
              label: "Navigation Test",
              prompt:
                "Create a navigation test for the main menu",
            },
            {
              label: "Button Click",
              prompt:
                "Create a test that clicks a button and verifies the result",
            },
          ]}
          placeholder="Describe the test you want to generate..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
          disclaimer="AI test generation is experimental"
        />
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-muted border border-border rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Delete Playwright Test
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete &quot;{form.name}&quot;? This action
              cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteDialogOpen(false)}
                className="px-4 py-2 text-sm bg-muted border border-border rounded hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
