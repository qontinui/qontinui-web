"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import {
  useTestsList,
  useCreateTest,
  useUpdateTest,
  useDeleteTest,
  useExecuteTest,
  useDuplicateTest,
  type RunnerTest,
} from "@/components/builders/hooks/useRunnerEntity";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import type { ExecutionResult } from "@/components/builders/editors";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { toast } from "sonner";
import type { AnalyzedElement } from "@/components/test-builder/SpecWorkflowBuilder";
import type { AnalysisData } from "@/components/test-builder/PageAnalyzer";
import type { UnifiedStep } from "@/types/unified-workflow";
import type { TestForm, EditorTab } from "../test-types";
import {
  TEST_TEMPLATES,
  AI_TEMPLATES_BY_TYPE,
  AI_TEMPLATES_GENERIC,
} from "../test-config";
import { isCodeEmptyOrTemplate } from "../test-utils";

export function useTestsPage() {
  // =========================================================================
  // UI State
  // =========================================================================

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

  // =========================================================================
  // Data Fetching & Mutations
  // =========================================================================

  const { data: testsData, isLoading, error, refetch } = useTestsList();
  const createMutation = useCreateTest();
  const updateMutation = useUpdateTest();
  const deleteMutation = useDeleteTest();
  const duplicateTestMutation = useDuplicateTest();
  const executeTest = useExecuteTest();

  // =========================================================================
  // Form Converters
  // =========================================================================

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

  // =========================================================================
  // CRUD Handlers
  // =========================================================================

  const onCreate = useCallback(async (data: Record<string, unknown>) => {
    return createMutation.mutateAsync(data);
  }, [createMutation]);

  const onUpdate = useCallback(async (id: string, data: Record<string, unknown>) => {
    return updateMutation.mutateAsync({ id, data });
  }, [updateMutation]);

  const onDelete = useCallback(async (id: string) => {
    return deleteMutation.mutateAsync(id);
  }, [deleteMutation]);

  // =========================================================================
  // Builder Page Hook
  // =========================================================================

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

  // =========================================================================
  // Duplicate
  // =========================================================================

  const handleDuplicateTest = async () => {
    if (!selectedItem || isNew) return;
    await duplicateTestMutation.mutateAsync({
      id: selectedItem.id,
      newName: `${selectedItem.name} (Copy)`,
    });
    await builderRefetch();
  };

  // =========================================================================
  // Auto-fill template on test_type change (new tests only)
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
  // Dynamic AI templates based on test type
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
  // Fill Metadata with AI
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
  // Import / Export
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

  // =========================================================================
  // Save / Delete
  // =========================================================================

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
  // Analysis / Apply Code
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

  return {
    // Data
    tests,
    isLoading,
    error,
    isOffline,
    selectedItem,
    form,
    setForm,
    isDirty,
    isNew,
    isSaving,

    // UI state
    addToWorkflowStep,
    setAddToWorkflowStep,
    aiGenerating,
    aiResult,
    aiError,
    aiMetadataGenerating,
    screenshotModalUrl,
    setScreenshotModalUrl,
    editorTab,
    setEditorTab,
    analysisElements,
    fileInputRef,

    // AI templates
    currentAiTemplates,

    // Actions
    onSelect,
    onNew,
    batchDelete,
    builderRefetch,
    handleDuplicateTest,
    handleTestTypeChange,
    handleAiGenerate,
    handleAiAccept,
    handleFillMetadataWithAi,
    handleExport,
    handleImport,
    handleExecuteTest,
    handleSave,
    handleDelete,
    handleAnalysisComplete,
    handleApplyTestCode,
  };
}
