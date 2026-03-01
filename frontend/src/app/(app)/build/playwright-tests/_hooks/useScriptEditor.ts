"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRunnerPromptSnippetsList } from "@/components/builders/hooks/useRunnerEntity";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { PlaywrightScript, PromptSnippet } from "@/lib/runner/types/library";
import type { ScriptForm, ViewMode } from "../script-utils";
import { toForm, toPayload, loadDraft, saveDraft, clearDraft } from "../script-utils";

interface UseScriptEditorOptions {
  item: PlaywrightScript;
  form: ScriptForm;
  setForm: (form: ScriptForm) => void;
  isDirty: boolean;
  isNew: boolean;
  onSave: () => void;
  onDelete: () => void;
}

export function useScriptEditor({
  item,
  form,
  setForm,
  isDirty,
  isNew,
  onSave,
  onDelete,
}: UseScriptEditorOptions) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("description");

  const promptSnippetsQuery = useRunnerPromptSnippetsList();
  const [showSnippetDropdown, setShowSnippetDropdown] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [snippetTarget, setSnippetTarget] = useState<
    "description" | "ai_instructions"
  >("description");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const aiInstructionsRef = useRef<HTMLTextAreaElement>(null);

  const [coverageWarnings, setCoverageWarnings] = useState<string[]>([]);
  const [isValidatingCoverage, setIsValidatingCoverage] = useState(false);

  const [hasDraft, setHasDraft] = useState(false);
  const draftCheckDone = useRef(false);

  const [isRegenerating, setIsRegenerating] = useState(false);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      saveDraft(item.id, form);
      setHasDraft(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, [form, isDirty, item.id]);

  const updateField = useCallback(<K extends keyof ScriptForm>(field: K, value: ScriptForm[K]) => {
    setForm({ ...form, [field]: value });
  }, [form, setForm]);

  const handleDelete = useCallback(async () => {
    clearDraft(item.id);
    await onDelete();
    setDeleteDialogOpen(false);
  }, [item.id, onDelete]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft(item.id);
    setForm(toForm(item));
    setHasDraft(false);
  }, [item, setForm]);

  const handleRestoreDraft = useCallback(() => {
    const draft = loadDraft(item.id);
    if (draft) {
      setForm(draft);
    }
    setHasDraft(false);
  }, [item.id, setForm]);

  const handleTextareaKeyUp = useCallback((
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    target: "description" | "ai_instructions"
  ) => {
    const textarea = e.currentTarget;
    const value = textarea.value;
    const cursorPos = textarea.selectionStart;

    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex >= 0) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] ?? " " : " ";
      if (/\s/.test(charBefore) && !/\s/.test(textAfterAt)) {
        setSnippetQuery(textAfterAt);
        setSnippetTarget(target);
        setShowSnippetDropdown(true);
        return;
      }
    }

    setShowSnippetDropdown(false);
  }, []);

  const handleSnippetSelect = useCallback((snippet: PromptSnippet) => {
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
  }, [snippetTarget, form, updateField]);

  const handleExport = useCallback(() => {
    const data = JSON.stringify(toPayload(form), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.name || "script"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [form]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [form, setForm]);

  const handleValidateCoverage = useCallback(async () => {
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
  }, [form.description, form.script_content]);

  const handleRegenerateDescription = useCallback(async () => {
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
  }, [form.script_content, updateField]);

  const runAutoRefine = useCallback(async () => {
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
        onSave();
        await new Promise((r) => setTimeout(r, 500));

        setAutoRefineLog((prev) => [...prev, "Running test..."]);
        const runResult = await runnerApi.runPlaywrightTest(item.id);
        setAutoRefineLog((prev) => [...prev, `Task run: ${runResult.task_run_id}`]);

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
  }, [isNew, item.id, autoRefineMaxIterations, onSave, form.script_content, form.target_url, form.ai_instructions, autoRefineUserHint, updateField]);

  const stopAutoRefine = useCallback(() => {
    autoRefineAbortRef.current = true;
    setIsAutoRefining(false);
  }, []);

  const handleAiGenerate = useCallback(async (_prompt: string) => {
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
  }, []);

  return {
    deleteDialogOpen,
    setDeleteDialogOpen,
    aiGenerating,
    aiError,
    viewMode,
    setViewMode,
    promptSnippetsQuery,
    showSnippetDropdown,
    setShowSnippetDropdown,
    snippetQuery,
    setSnippetQuery,
    snippetTarget,
    setSnippetTarget,
    descriptionRef,
    aiInstructionsRef,
    coverageWarnings,
    setCoverageWarnings,
    isValidatingCoverage,
    hasDraft,
    isRegenerating,
    isAutoRefining,
    autoRefineIteration,
    autoRefineMaxIterations,
    setAutoRefineMaxIterations,
    autoRefineLog,
    autoRefineUserHint,
    setAutoRefineUserHint,
    videoAfterIterations,
    setVideoAfterIterations,
    fileInputRef,
    updateField,
    handleDelete,
    handleDiscardDraft,
    handleRestoreDraft,
    handleTextareaKeyUp,
    handleSnippetSelect,
    handleExport,
    handleImport,
    handleFileChange,
    handleValidateCoverage,
    handleRegenerateDescription,
    runAutoRefine,
    stopAutoRefine,
    handleAiGenerate,
  };
}
