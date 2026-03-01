"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import {
  TestTube2,
  Code2,
  Tag,
  Wand2,
  Loader2,
  Download,
  Upload,
  Image as ImageIcon,
  Terminal,
  Eye,
  GitBranch,
  Workflow,
  ScanSearch,
  Link2,
  ListChecks,
} from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  useTestsList,
  useCreateTest,
  useUpdateTest,
  useDeleteTest,
  useExecuteTest,
  useDuplicateTest,
  type RunnerTest,
} from "@/components/builders/hooks/useRunnerEntity";
import {
  EditorHeader,
  EditorSection,
  MonacoField,
  ExecutionPanel,
  type ExecutionResult,
} from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import { PageAnalyzer, type AnalysisData } from "@/components/test-builder/PageAnalyzer";
import { TestOrchestrator } from "@/components/test-builder/TestOrchestrator";
import { SpecWorkflowBuilder, type AnalyzedElement } from "@/components/test-builder/SpecWorkflowBuilder";
import type { UnifiedStep } from "@/types/unified-workflow";

// =============================================================================
// Types
// =============================================================================

interface TestForm {
  name: string;
  description: string;
  test_type: string;
  code: string;
  url: string;
  tags: string[];
}

// =============================================================================
// Test Type Configuration
// =============================================================================

const TEST_TYPES = [
  {
    id: "python_script",
    label: "Python Script",
    color: "amber",
    language: "python",
    description: "Custom Python test script",
    icon: Terminal,
    badgeClasses: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    dotClass: "bg-emerald-400",
  },
  {
    id: "qontinui_vision",
    label: "Qontinui Vision",
    color: "cyan",
    language: "python",
    description: "Visual automation test with Qontinui",
    icon: Eye,
    badgeClasses: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    dotClass: "bg-purple-400",
    devOnly: true,
  },
  {
    id: "repository_test",
    label: "Repository Test",
    color: "gray",
    language: "shell",
    description: "Shell script for repository testing",
    icon: GitBranch,
    badgeClasses: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    dotClass: "bg-orange-400",
  },
] as const;

const TEST_TYPE_MAP = Object.fromEntries(
  TEST_TYPES.map((t) => [t.id, t])
);

// =============================================================================
// Default Code Templates (Feature 1)
// =============================================================================

const TEST_TEMPLATES: Record<string, string> = {
  python_script: `import pytest

def test_example():
    """Test description here"""
    # Arrange
    expected = True

    # Act
    result = True

    # Assert
    assert result == expected
`,
  qontinui_vision: `# Qontinui Vision Test
# This test uses visual AI to verify UI elements

from qontinui import vision

def test_visual_check():
    """Visual verification test"""
    # Capture the current screen state
    screenshot = vision.capture()

    # Verify expected elements are visible
    assert vision.find_element(screenshot, "target_element")
`,
  repository_test: `#!/bin/bash
# Repository Test
# Validates repository structure and configuration

set -e

echo "Running repository checks..."

# Check required files exist
test -f README.md && echo "OK README.md exists" || echo "FAIL README.md missing"
test -f package.json && echo "OK package.json exists" || echo "FAIL package.json missing"

echo "Repository check complete"
`,
};

/** Check if the current code is empty or matches any template (possibly with URL substitution) */
function isCodeEmptyOrTemplate(code: string): boolean {
  if (!code.trim()) return true;
  const trimmed = code.trim();
  for (const template of Object.values(TEST_TEMPLATES)) {
    // Check against the raw template and any URL-substituted variant
    const rawTrimmed = template.trim();
    if (trimmed === rawTrimmed) return true;
    // Also check if it's a template with {{url}} replaced by something
    const escaped = rawTrimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.replace("\\{\\{url\\}\\}", ".*");
    if (new RegExp(`^${pattern}$`, "s").test(trimmed)) return true;
  }
  return false;
}

// =============================================================================
// AI Templates per Test Type (Feature 2)
// =============================================================================

const AI_TEMPLATES_BY_TYPE: Record<string, Array<{ label: string; prompt: string }>> = {
  python_script: [
    { label: "Unit test for a function", prompt: "Create a unit test for a Python function that validates inputs and returns expected outputs" },
    { label: "Integration test", prompt: "Create an integration test that verifies multiple components work together correctly" },
    { label: "API test", prompt: "Create a test that makes HTTP requests to API endpoints and verifies response status codes and data" },
  ],
  qontinui_vision: [
    { label: "Visual element verification", prompt: "Create a vision test that verifies specific UI elements are visible and correctly positioned on screen" },
    { label: "Screen state validation", prompt: "Create a vision test that captures the screen state and validates it matches the expected layout" },
  ],
  repository_test: [
    { label: "CI/CD check", prompt: "Create a repository test that validates CI/CD configuration files are present and correctly formatted" },
    { label: "Config validation", prompt: "Create a repository test that checks all configuration files are valid and contain required fields" },
  ],
};

// Fallback generic templates
const AI_TEMPLATES_GENERIC = [
  { label: "Login flow test", prompt: "Create a test that logs into a web application with username and password" },
  { label: "API integration test", prompt: "Create a test that verifies API endpoints are responding correctly" },
  { label: "Form validation", prompt: "Create a test that validates form input fields and error messages" },
  { label: "Page navigation", prompt: "Create a test that navigates through multiple pages and verifies content" },
];

// =============================================================================
// Component
// =============================================================================

type EditorTab = "editor" | "analyzer" | "orchestrator" | "spec";

const EDITOR_TABS = [
  { id: "editor" as const, label: "Editor", icon: Code2 },
  { id: "analyzer" as const, label: "Page Analyzer", icon: ScanSearch },
  { id: "orchestrator" as const, label: "Orchestrator", icon: Link2 },
  { id: "spec" as const, label: "Spec Workflow", icon: ListChecks },
];

export default function TestsPage() {
  const isDev = process.env.NODE_ENV === "development";
  const visibleTestTypes = isDev
    ? TEST_TYPES
    : TEST_TYPES.filter((t) => !("devOnly" in t && t.devOnly));

  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMetadataGenerating, setAiMetadataGenerating] = useState(false);
  const [screenshotModalUrl, setScreenshotModalUrl] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const [analysisElements, setAnalysisElements] = useState<AnalyzedElement[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track the previous test_type for template auto-fill
  const prevTestTypeRef = useRef<string>("python_script");

  // Fetch data
  const { data: testsData, isLoading, error, refetch } = useTestsList();
  const createMutation = useCreateTest();
  const updateMutation = useUpdateTest();
  const deleteMutation = useDeleteTest();
  const duplicateTestMutation = useDuplicateTest();
  const executeTest = useExecuteTest();

  // Form converters
  const toForm = useCallback((item: RunnerTest): TestForm => ({
    name: item.name,
    description: item.description || "",
    test_type: item.test_type,
    code: item.code,
    url: item.url || "",
    tags: item.tags || [],
  }), []);

  const defaultForm = useCallback(
    (): TestForm => ({
      name: "",
      description: "",
      test_type: "python_script",
      code: "",
      url: "",
      tags: [],
    }),
    []
  );

  const toPayload = useCallback((form: TestForm) => ({
    name: form.name,
    description: form.description || undefined,
    test_type: form.test_type,
    code: form.code,
    url: form.url || undefined,
    tags: form.tags.length > 0 ? form.tags : undefined,
  }), []);

  // CRUD handlers
  const onCreate = useCallback(async (data: Record<string, unknown>) => {
    return createMutation.mutateAsync(data);
  }, [createMutation]);

  const onUpdate = useCallback(async (id: string, data: Record<string, unknown>) => {
    return updateMutation.mutateAsync({ id, data });
  }, [updateMutation]);

  const onDelete = useCallback(async (id: string) => {
    return deleteMutation.mutateAsync(id);
  }, [deleteMutation]);

  // Use builder page hook
  const {
    items: tests,
    isOffline,
    selectedItem,
    onSelect,
    onNew,
    onDelete: batchDelete,
    refetch: builderRefetch,
    form,
    setForm,
    isDirty,
    isNew,
    isSaving,
    save,
    deleteSelected,
  } = useBuilderPage<RunnerTest, TestForm>({
    items: testsData,
    isLoading,
    error,
    isOffline: !!error && !testsData,
    toForm,
    defaultForm,
    toPayload,
    onCreate,
    onUpdate,
    onDelete,
    refetch: async () => { await refetch(); },
  });

  const handleDuplicateTest = async () => {
    if (!selectedItem || isNew) return;
    await duplicateTestMutation.mutateAsync({
      id: selectedItem.id,
      newName: `${selectedItem.name} (Copy)`,
    });
    await builderRefetch();
  };

  // =========================================================================
  // Feature 1: Auto-fill template on test_type change (new tests only)
  // =========================================================================

  const handleTestTypeChange = useCallback((newType: string) => {
    const shouldAutoFill = isNew && isCodeEmptyOrTemplate(form.code);

    if (shouldAutoFill) {
      let template = TEST_TEMPLATES[newType] || "";
      // Replace {{url}} with form URL if set
      if (form.url) {
        template = template.replace("{{url}}", form.url);
      }
      setForm((prev) => ({ ...prev, test_type: newType, code: template }));
    } else {
      setForm((prev) => ({ ...prev, test_type: newType }));
    }
    prevTestTypeRef.current = newType;
  }, [isNew, form.code, form.url, setForm]);

  // =========================================================================
  // Feature 2: Dynamic AI templates based on test type
  // =========================================================================

  const currentAiTemplates = useMemo(() => {
    const typeTemplates = AI_TEMPLATES_BY_TYPE[form.test_type];
    if (typeTemplates) {
      return [...typeTemplates, ...AI_TEMPLATES_GENERIC];
    }
    return AI_TEMPLATES_GENERIC;
  }, [form.test_type]);

  // =========================================================================
  // AI Generation handlers
  // =========================================================================

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await runnerApi.aiGenerateTest(prompt, form.test_type);
      if (res.success && res.data) {
        setAiResult(res.data);
      } else {
        setAiError(res.message || "Generation failed");
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAccept = () => {
    if (!aiResult) return;

    const updates: Partial<TestForm> = {};
    if (typeof aiResult.name === "string") {
      updates.name = aiResult.name;
    }
    if (typeof aiResult.description === "string") {
      updates.description = aiResult.description;
    }
    if (typeof aiResult.test_type === "string") {
      updates.test_type = aiResult.test_type;
    }
    if (typeof aiResult.code === "string") {
      updates.code = aiResult.code;
    }
    if (typeof aiResult.url === "string") {
      updates.url = aiResult.url;
    }
    if (Array.isArray(aiResult.tags)) {
      updates.tags = aiResult.tags.filter((t): t is string => typeof t === "string");
    }

    setForm((prev) => ({ ...prev, ...updates }));
    setAiResult(null);
    toast.success("AI-generated test applied");
  };

  // =========================================================================
  // Feature 3: Fill Metadata with AI
  // =========================================================================

  const handleFillMetadataWithAi = async () => {
    if (!form.code.trim()) {
      toast.error("Add test code first before generating metadata");
      return;
    }
    setAiMetadataGenerating(true);
    try {
      const prompt = `Analyze this test code and generate metadata for it. Return a JSON object with "name" (short descriptive test name), "description" (1-2 sentence description of what the test does), and "tags" (array of relevant tags). The test type is "${form.test_type}".\n\nCode:\n${form.code.slice(0, 2000)}`;
      const res = await runnerApi.aiGenerateTest(prompt, form.test_type);
      if (res.success && res.data) {
        const updates: Partial<TestForm> = {};
        if (typeof res.data.name === "string" && res.data.name) {
          updates.name = res.data.name;
        }
        if (typeof res.data.description === "string" && res.data.description) {
          updates.description = res.data.description;
        }
        if (Array.isArray(res.data.tags) && res.data.tags.length > 0) {
          updates.tags = res.data.tags.filter((t): t is string => typeof t === "string");
        }
        if (Object.keys(updates).length > 0) {
          setForm((prev) => ({ ...prev, ...updates }));
          toast.success("AI-generated metadata applied");
        } else {
          toast.info("AI could not generate metadata from the code");
        }
      } else {
        toast.error(res.message || "Failed to generate metadata");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate metadata");
    } finally {
      setAiMetadataGenerating(false);
    }
  };

  // =========================================================================
  // Feature 4: Import / Export
  // =========================================================================

  const handleExport = () => {
    const data = JSON.stringify(toPayload(form), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.name || "test"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        const updates: Partial<TestForm> = {};
        if (typeof parsed.name === "string") updates.name = parsed.name;
        if (typeof parsed.description === "string") updates.description = parsed.description;
        if (typeof parsed.test_type === "string") updates.test_type = parsed.test_type;
        if (typeof parsed.code === "string") updates.code = parsed.code;
        if (typeof parsed.url === "string") updates.url = parsed.url;
        if (Array.isArray(parsed.tags)) {
          updates.tags = parsed.tags.filter((t: unknown): t is string => typeof t === "string");
        }
        setForm((prev) => ({ ...prev, ...updates }));
        toast.success("Test imported successfully");
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    // Reset file input so the same file can be re-imported
    event.target.value = "";
  };

  // =========================================================================
  // Test execution
  // =========================================================================

  const handleExecuteTest = async (): Promise<ExecutionResult> => {
    if (!selectedItem || isNew) {
      throw new Error("Save the test before executing");
    }
    try {
      const result = await executeTest.mutateAsync(selectedItem.id);
      return result as ExecutionResult;
    } catch (err) {
      throw err;
    }
  };

  // Handlers
  const handleSave = async () => {
    try {
      await save();
      toast.success(isNew ? "Test created" : "Test saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save test");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSelected();
      toast.success("Test deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete test");
    }
  };

  // =========================================================================
  // Feature 7: Language auto-detection for Monaco
  // =========================================================================

  const getLanguageForTestType = (testType: string): string => {
    switch (testType) {
      case "python_script": return "python";
      case "qontinui_vision": return "python";
      case "repository_test": return "shell";
      default: return "python";
    }
  };

  // =========================================================================
  // Feature 6: List item renderer with visual indicators
  // =========================================================================

  const renderListItem = (item: RunnerTest, _isSelected: boolean) => {
    const testTypeInfo = TEST_TYPE_MAP[item.test_type];
    const TypeIcon = testTypeInfo?.icon || TestTube2;

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <TypeIcon className={`size-3.5 flex-shrink-0 ${
            item.test_type === "python_script" ? "text-emerald-400" :
            item.test_type === "qontinui_vision" ? "text-purple-400" :
            item.test_type === "repository_test" ? "text-orange-400" :
            "text-muted-foreground"
          }`} />
          <div className="font-semibold text-foreground truncate">
            {item.name}
          </div>
        </div>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${testTypeInfo?.badgeClasses || ""}`}
          >
            {testTypeInfo?.label || item.test_type}
          </Badge>
          {item.tags && item.tags.length > 0 && (
            <div className="flex items-center gap-0.5">
              <Tag className="size-2.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                {item.tags.length}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // =========================================================================
  // Editor renderer
  // =========================================================================

  const handleAnalysisComplete = useCallback((analysis: AnalysisData) => {
    // Extract elements from analysis data for use in SpecWorkflowBuilder
    if (analysis.type === "single" && analysis.data.elements) {
      const elements: AnalyzedElement[] = analysis.data.elements.map((el) => ({
        id: el.id,
        label: el.label || `Element ${el.id}`,
        tagName: el.element_type || "div",
        type: el.element_type || "element",
        text: el.text_content,
        selector: el.selector,
        visible: true,
        enabled: true,
        bounds: el.bounding_box,
        attributes: el.attributes,
      }));
      setAnalysisElements((prev) => [...prev, ...elements]);
      toast.success(`Collected ${elements.length} elements from analysis`);
    }
  }, []);

  const handleApplyTestCode = useCallback((code: string) => {
    setForm((prev) => ({ ...prev, code }));
    setEditorTab("editor");
    toast.success("Test code applied");
  }, [setForm]);

  const renderEditor = (_item: RunnerTest) => {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-4">
          {/* Tab Bar */}
          <div className="flex items-center gap-1 border-b border-border pb-0">
            {EDITOR_TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = editorTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEditorTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all border-b-2 -mb-[1px] ${
                    isActive
                      ? "text-emerald-400 border-emerald-400"
                      : "text-muted-foreground border-transparent hover:text-muted-foreground hover:border-border"
                  }`}
                >
                  <TabIcon className="size-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Page Analyzer Tab */}
          {editorTab === "analyzer" && (
            <PageAnalyzer onAnalysisComplete={handleAnalysisComplete} />
          )}

          {/* Test Orchestrator Tab */}
          {editorTab === "orchestrator" && (
            <TestOrchestrator onTestGenerated={(code) => handleApplyTestCode(code)} />
          )}

          {/* Spec Workflow Builder Tab */}
          {editorTab === "spec" && (
            <SpecWorkflowBuilder
              elements={analysisElements}
              onGenerate={(code) => handleApplyTestCode(code)}
            />
          )}

          {/* Editor Tab (existing content) */}
          {editorTab === "editor" && (
          <>
          {/* Header */}
          <EditorHeader
            name={form.name}
            onNameChange={(name) => setForm({ ...form, name })}
            onSave={handleSave}
            onDelete={!isNew ? handleDelete : undefined}
            onDuplicate={handleDuplicateTest}
            isSaving={isSaving}
            isDirty={isDirty}
            isNew={isNew}
            nameplaceholder="Test name..."
          />

          {/* Feature 3: Fill Metadata with AI + Feature 4: Import/Export toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
              onClick={handleFillMetadataWithAi}
              disabled={aiMetadataGenerating || !form.code.trim()}
              title="Analyze code and auto-fill name, description, and tags"
            >
              {aiMetadataGenerating ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Wand2 className="size-3" />
              )}
              Fill Metadata with AI
            </Button>

            <div className="flex-1" />

            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleExport}
              title="Export test as JSON"
            >
              <Download className="size-3" />
              Export
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => fileInputRef.current?.click()}
              title="Import test from JSON"
            >
              <Upload className="size-3" />
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>

          {/* Description */}
          <EditorSection title="Description" defaultOpen={false}>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe what this test does..."
              className="min-h-[80px] text-sm bg-background border-border resize-none"
            />
          </EditorSection>

          {/* Test Type (Feature 1: auto-fill template on type change) */}
          <EditorSection title="Test Type" icon={Code2}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {visibleTestTypes.map((type) => {
                  const isSelected = form.test_type === type.id;
                  const TypeIcon = type.icon;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => handleTestTypeChange(type.id)}
                      className={`
                        flex flex-col gap-1 p-3 rounded-lg border transition-all text-left
                        ${isSelected
                          ? `bg-${type.color}-500/10 border-${type.color}-500/40`
                          : "bg-muted/50 border-border hover:border-border"
                        }
                      `}
                    >
                      <div className="flex items-center gap-2">
                        <TypeIcon className={`size-3.5 ${isSelected ? `text-${type.color}-400` : "text-muted-foreground"}`} />
                        <span className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                          {type.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-6">
                        {type.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </EditorSection>

          {/* URL (for web-based tests) */}
          {form.test_type === "qontinui_vision" && (
            <EditorSection title="Target URL" defaultOpen={false}>
              <div className="space-y-2">
                <Label htmlFor="test-url" className="text-sm text-muted-foreground">
                  URL to test (optional)
                </Label>
                <Input
                  id="test-url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://example.com"
                  className="bg-muted border-border h-9 text-sm"
                />
              </div>
            </EditorSection>
          )}

          {/* Code (Feature 7: language auto-detection) */}
          <EditorSection title="Test Code" defaultOpen={true}>
            <MonacoField
              value={form.code}
              onChange={(code) => setForm({ ...form, code })}
              language={getLanguageForTestType(form.test_type)}
              height="400px"
            />
          </EditorSection>

          {/* Tags */}
          <EditorSection title="Tags" icon={Tag} defaultOpen={false}>
            <TagInput
              tags={form.tags}
              onChange={(tags) => setForm({ ...form, tags })}
              placeholder="Add tag..."
            />
          </EditorSection>

          {/* Execution Panel (Feature 5: screenshot modal in results) */}
          <ExecutionPanel
            onRun={handleExecuteTest}
            isRunnerOffline={isOffline}
            disabled={isNew || isDirty}
            runLabel="Run Test"
          />

          {/* Feature 5: Screenshot from last execution result */}
          {selectedItem && !isNew && (
            <ScreenshotResultSection
              testId={selectedItem.id}
              onOpenScreenshot={setScreenshotModalUrl}
            />
          )}

          {/* AI Generator (Feature 2: dynamic templates per test type) */}
          <AiGeneratorPanel
            title="AI Generate Test"
            accentColor="purple"
            templates={currentAiTemplates}
            placeholder="Describe the test you want to generate..."
            generating={aiGenerating}
            error={aiError}
            onGenerate={handleAiGenerate}
            result={aiResult ? (
              <div className="space-y-3 text-sm">
                {typeof aiResult.name === "string" && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Name</div>
                    <div className="text-foreground">{aiResult.name}</div>
                  </div>
                )}
                {typeof aiResult.description === "string" && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Description</div>
                    <div className="text-muted-foreground">{aiResult.description}</div>
                  </div>
                )}
                {typeof aiResult.test_type === "string" && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Test Type</div>
                    <Badge variant="outline" className="text-xs">
                      {TEST_TYPE_MAP[aiResult.test_type]?.label || aiResult.test_type}
                    </Badge>
                  </div>
                )}
                {typeof aiResult.url === "string" && aiResult.url && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">URL</div>
                    <div className="text-muted-foreground text-xs font-mono">{aiResult.url}</div>
                  </div>
                )}
                {typeof aiResult.code === "string" && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Code Preview</div>
                    <pre className="text-xs text-muted-foreground bg-background p-3 rounded overflow-x-auto max-h-48 overflow-y-auto font-mono border border-border">
                      {aiResult.code.slice(0, 800)}
                      {aiResult.code.length > 800 && "\n..."}
                    </pre>
                  </div>
                )}
                {Array.isArray(aiResult.tags) && aiResult.tags.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Tags</div>
                    <div className="flex flex-wrap gap-1">
                      {aiResult.tags.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {String(tag)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : undefined}
            onAccept={handleAiAccept}
            acceptLabel="Apply to Test"
            extraInputs={
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  AI will generate for: {TEST_TYPE_MAP[form.test_type]?.label}
                </Label>
              </div>
            }
            disclaimer="AI-generated tests should be reviewed before execution"
          />
          </>
          )}
        </div>

        {/* Feature 5: Screenshot Modal */}
        <Dialog
          open={!!screenshotModalUrl}
          onOpenChange={(open) => !open && setScreenshotModalUrl(null)}
        >
          <DialogContent className="sm:max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>Test Screenshot</DialogTitle>
            </DialogHeader>
            {screenshotModalUrl && (
              <div className="overflow-auto max-h-[75vh]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotModalUrl}
                  alt="Test execution screenshot"
                  className="w-full h-auto rounded"
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const renderListActions = useCallback(
    (item: RunnerTest) => {
      const testTypeMap: Record<string, string> = {
        python_script: "python",
        qontinui_vision: "qontinui_vision",
        repository_test: "repository",
      };
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
          title="Insert into Workflow"
          onClick={() => {
            setAddToWorkflowStep({
              type: "command",
              name: item.name,
              test_type: (testTypeMap[item.test_type] || "custom_command") as import("@/types/unified-workflow").TestType,
              test_id: item.id,
            });
          }}
        >
          <Workflow className="size-3.5" />
        </Button>
      );
    },
    []
  );

  return (
    <>
      <BuilderLayout
        title="Tests"
        icon={TestTube2}
        iconColor="text-emerald-400"
        accentColor="emerald"
        items={tests}
        isLoading={isLoading}
        error={error ? String(error) : null}
        isOffline={isOffline}
        selectedItem={selectedItem}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={batchDelete}
        refetch={builderRefetch}
        renderListItem={renderListItem}
        renderListActions={renderListActions}
        renderEditor={renderEditor}
        emptyIcon={TestTube2}
        emptyTitle="No tests yet"
        emptyDescription="Create automated tests"
        itemLabel="test"
        searchPlaceholder="Search tests..."
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
// Feature 5: Screenshot Result Section (sub-component)
// =============================================================================

function ScreenshotResultSection({
  testId,
  onOpenScreenshot,
}: {
  testId: string;
  onOpenScreenshot: (url: string) => void;
}) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Attempt to fetch screenshot from the last execution result
  // This runs once when the component mounts or testId changes
  const fetchScreenshot = useCallback(async () => {
    if (checked) return;
    setChecked(true);
    try {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      const result = await runnerFetch<Record<string, unknown>>(`/tests/${testId}/last-result`);
      if (result) {
        // Check for screenshot data in various fields
        const screenshot = result.screenshot as string | undefined;
        const screenshotPath = result.screenshot_path as string | undefined;
        const screenshotBase64 = result.screenshot_base64 as string | undefined;

        if (screenshotBase64) {
          const prefix = screenshotBase64.startsWith("data:") ? "" : "data:image/png;base64,";
          setScreenshotUrl(`${prefix}${screenshotBase64}`);
        } else if (screenshot && screenshot.startsWith("data:")) {
          setScreenshotUrl(screenshot);
        } else if (screenshotPath) {
          // If it's a file path, we can't display it directly in the browser
          // but we'll try as a URL in case the runner serves it
          setScreenshotUrl(`http://localhost:9876/screenshots/${encodeURIComponent(screenshotPath)}`);
        }
      }
    } catch {
      // Silently fail - no screenshot available is fine
    }
  }, [testId, checked]);

  // Run on mount
  useState(() => { fetchScreenshot(); });

  if (!screenshotUrl) return null;

  return (
    <div className="border border-border rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Last Execution Screenshot</span>
      </div>
      <button
        type="button"
        onClick={() => onOpenScreenshot(screenshotUrl)}
        className="block overflow-hidden rounded border border-border hover:border-text-muted transition-colors cursor-pointer"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={screenshotUrl}
          alt="Test execution screenshot thumbnail"
          className="w-48 h-auto object-contain"
        />
      </button>
    </div>
  );
}
