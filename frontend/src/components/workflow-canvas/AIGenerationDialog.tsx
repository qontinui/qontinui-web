/**
 * AI Generation Dialog - Natural language workflow creation
 *
 * Features:
 * - Large text area for workflow description
 * - Example prompts and templates
 * - Context options (existing workflow, templates)
 * - Real-time generation with progress
 * - Preview generated workflow
 * - Alternative suggestions
 * - Refinement input
 * - Explanation panel
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  X,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  RefreshCw,
  Copy,
  Lightbulb,
} from "lucide-react";
import { getMCPClient } from "../../services/mcp-client";
import type {
  GeneratedWorkflow,
  GenerationContext,
} from "../../services/mcp-client";
import type { Workflow } from "../../lib/action-schema/action-types";
import {
  PROMPT_TEMPLATES,
  type PromptTemplate,
} from "../../services/prompt-templates";

// ============================================================================
// Types
// ============================================================================

interface AIGenerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: (workflow: Workflow) => void;
  existingWorkflow?: Workflow;
  initialPrompt?: string;
}

type GenerationState = "idle" | "generating" | "success" | "error" | "refining";

// ============================================================================
// Component
// ============================================================================

export function AIGenerationDialog({
  isOpen,
  onClose,
  onAccept,
  existingWorkflow,
  initialPrompt = "",
}: AIGenerationDialogProps) {
  // State
  const [description, setDescription] = useState(initialPrompt);
  const [state, setState] = useState<GenerationState>("idle");
  const [result, setResult] = useState<GeneratedWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlternative, setSelectedAlternative] = useState<number | null>(
    null
  );
  const [refinementInput, setRefinementInput] = useState("");
  const [showExamples, setShowExamples] = useState(true);

  // Context options
  const [useExistingWorkflow, setUseExistingWorkflow] =
    useState(!!existingWorkflow);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const mcpClient = getMCPClient();

  // Focus text area when dialog opens
  useEffect(() => {
    if (isOpen && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDescription(initialPrompt);
      setState("idle");
      setError(null);
      setSelectedAlternative(null);
      setRefinementInput("");
    }
  }, [isOpen, initialPrompt]);

  // ==========================================================================
  // Generation
  // ==========================================================================

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) {
      setError("Please enter a workflow description");
      return;
    }

    setState("generating");
    setError(null);
    setResult(null);
    setSelectedAlternative(null);

    try {
      const context: GenerationContext = {
        existingWorkflow: useExistingWorkflow ? existingWorkflow : undefined,
        templates: selectedTemplates,
      };

      const generated = await mcpClient.generateWorkflow(description, context);

      setResult(generated);
      setState("success");
      setShowExamples(false);
    } catch (err) {
      console.error("Generation failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate workflow"
      );
      setState("error");
    }
  }, [
    description,
    existingWorkflow,
    useExistingWorkflow,
    selectedTemplates,
    mcpClient,
  ]);

  // ==========================================================================
  // Refinement
  // ==========================================================================

  const handleRefine = useCallback(async () => {
    if (!result || !refinementInput.trim()) return;

    setState("refining");
    setError(null);

    try {
      const refined = await mcpClient.refineWorkflow(
        result.workflow,
        refinementInput
      );

      setResult(refined);
      setState("success");
      setRefinementInput("");
    } catch (err) {
      console.error("Refinement failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to refine workflow"
      );
      setState("success"); // Keep result visible
    }
  }, [result, refinementInput, mcpClient]);

  // ==========================================================================
  // Accept
  // ==========================================================================

  const handleAccept = useCallback(() => {
    if (!result) return;

    const workflowToAccept =
      selectedAlternative !== null
        ? result.alternatives?.[selectedAlternative]?.workflow
        : result.workflow;

    if (workflowToAccept) {
      onAccept(workflowToAccept);
      onClose();
    }
  }, [result, selectedAlternative, onAccept, onClose]);

  // ==========================================================================
  // Template Selection
  // ==========================================================================

  const handleTemplateSelect = useCallback((template: PromptTemplate) => {
    setSelectedTemplates([template.id]);
    setDescription(template.template);
    setShowExamples(false);
  }, []);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (!isOpen) return null;

  const currentWorkflow =
    selectedAlternative !== null
      ? result?.alternatives?.[selectedAlternative]?.workflow
      : result?.workflow;

  const confidence =
    selectedAlternative !== null
      ? result?.alternatives?.[selectedAlternative]?.confidence
      : result?.confidence;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl h-[90vh] bg-white dark:bg-surface-canvas rounded-lg shadow-2xl flex flex-col" data-ui-id="dialog-ai-generation">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle dark:border-border-default">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary dark:text-white">
                AI Workflow Generator
              </h2>
              <p className="text-sm text-text-muted dark:text-text-muted">
                Describe your workflow in plain English
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-raised/50 dark:hover:bg-surface-raised rounded-lg transition-colors"
            data-ui-id="dialog-ai-generation-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Input */}
          <div className="w-1/2 border-r border-border-subtle dark:border-border-default flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Description Input */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
                  Workflow Description
                </label>
                <textarea
                  ref={textAreaRef}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Example: Create a workflow that logs into Gmail by clicking the login button and typing my credentials..."
                  className="w-full h-48 px-4 py-3 border border-border-default dark:border-border-default rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none bg-white dark:bg-surface-raised text-text-primary dark:text-white"
                  disabled={state === "generating" || state === "refining"}
                  data-ui-id="dialog-ai-generation-description-input"
                />
                <div className="mt-2 text-xs text-text-muted dark:text-text-muted">
                  {description.length} characters
                </div>
              </div>

              {/* Context Options */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary">
                  Context Options
                </h3>

                {existingWorkflow && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useExistingWorkflow}
                      onChange={(e) => setUseExistingWorkflow(e.target.checked)}
                      className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-sm text-text-muted dark:text-text-muted">
                      Extend existing workflow (
                      {existingWorkflow.actions.length} actions)
                    </span>
                  </label>
                )}

                <div>
                  <label className="block text-xs text-text-muted dark:text-text-muted mb-2">
                    Use Templates
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "web_scraping",
                      "automation",
                      "data_processing",
                      "testing",
                    ].map((templateId) => (
                      <button
                        key={templateId}
                        onClick={() => {
                          setSelectedTemplates((prev) =>
                            prev.includes(templateId)
                              ? prev.filter((t) => t !== templateId)
                              : [...prev, templateId]
                          );
                        }}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                          selectedTemplates.includes(templateId)
                            ? "bg-purple-600 text-white"
                            : "bg-surface-raised/50 dark:bg-surface-raised text-text-muted dark:text-text-muted hover:bg-surface-raised dark:hover:bg-surface-raised/80"
                        }`}
                      >
                        {templateId.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Example Templates */}
              {showExamples && (
                <div>
                  <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-3">
                    Example Prompts
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(PROMPT_TEMPLATES)
                      .slice(0, 5)
                      .map(([id, template]) => (
                        <button
                          key={id}
                          onClick={() => handleTemplateSelect(template)}
                          className="w-full text-left px-4 py-3 bg-surface-raised/50 dark:bg-surface-raised hover:bg-surface-raised dark:hover:bg-surface-raised/80 rounded-lg transition-colors group"
                        >
                          <div className="font-medium text-sm text-text-primary dark:text-white mb-1">
                            {template.name}
                          </div>
                          <div className="text-xs text-text-muted dark:text-text-muted">
                            {template.description}
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-red-800 dark:text-red-300 text-sm">
                      Generation Failed
                    </div>
                    <div className="text-red-700 dark:text-red-400 text-sm mt-1">
                      {error}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <div className="p-6 border-t border-border-subtle dark:border-border-default">
              <button
                onClick={handleGenerate}
                disabled={
                  !description.trim() ||
                  state === "generating" ||
                  state === "refining"
                }
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-surface-raised disabled:text-text-muted dark:disabled:bg-surface-raised text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                data-ui-id="dialog-ai-generation-generate-btn"
              >
                {state === "generating" ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating Workflow...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Workflow
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel - Preview */}
          <div className="w-1/2 flex flex-col">
            {result ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {/* Confidence Badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          confidence! >= 0.9
                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : confidence! >= 0.7
                              ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                              : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                        }`}
                      >
                        {Math.round(confidence! * 100)}% Confidence
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          JSON.stringify(currentWorkflow, null, 2)
                        );
                      }}
                      className="p-2 hover:bg-surface-raised/50 dark:hover:bg-surface-raised rounded-lg transition-colors"
                      title="Copy workflow JSON"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Workflow Preview */}
                  <div>
                    <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
                      Generated Workflow
                    </h3>
                    <div className="p-4 bg-surface-raised/50 dark:bg-surface-raised rounded-lg">
                      <div className="font-medium text-text-primary dark:text-white mb-2">
                        {currentWorkflow?.name}
                      </div>
                      <div className="text-sm text-text-muted dark:text-text-muted">
                        {currentWorkflow?.actions.length} actions
                      </div>
                    </div>
                  </div>

                  {/* Explanation */}
                  <div>
                    <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
                      Explanation
                    </h3>
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-900 dark:text-blue-300">
                      {result.explanation}
                    </div>
                  </div>

                  {/* Reasoning */}
                  {result.reasoning && result.reasoning.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
                        Reasoning
                      </h3>
                      <ul className="space-y-1">
                        {result.reasoning.map((reason, i) => (
                          <li
                            key={i}
                            className="text-sm text-text-muted dark:text-text-muted flex items-start gap-2"
                          >
                            <Check className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Alternatives */}
                  {result.alternatives && result.alternatives.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
                        Alternative Approaches
                      </h3>
                      <div className="space-y-2">
                        {result.alternatives.map((alt, i) => (
                          <button
                            key={i}
                            onClick={() => setSelectedAlternative(i)}
                            className={`w-full text-left p-3 rounded-lg transition-colors ${
                              selectedAlternative === i
                                ? "bg-purple-100 dark:bg-purple-900/30 border-2 border-purple-600"
                                : "bg-surface-raised/50 dark:bg-surface-raised hover:bg-surface-raised dark:hover:bg-surface-raised/80"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-medium text-sm text-text-primary dark:text-white">
                                Alternative {i + 1}
                              </div>
                              <div className="text-xs text-text-muted dark:text-text-muted">
                                {Math.round(alt.confidence * 100)}%
                              </div>
                            </div>
                            <div className="text-xs text-text-muted dark:text-text-muted">
                              {alt.reason}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {result.suggestions && result.suggestions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-yellow-500" />
                        Suggestions
                      </h3>
                      <ul className="space-y-1">
                        {result.suggestions.map((suggestion, i) => (
                          <li
                            key={i}
                            className="text-sm text-text-muted dark:text-text-muted"
                          >
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Refinement Input */}
                  <div>
                    <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
                      Refine Workflow
                    </h3>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={refinementInput}
                        onChange={(e) => setRefinementInput(e.target.value)}
                        placeholder="e.g., Add error handling, Make it faster..."
                        className="flex-1 px-3 py-2 border border-border-default dark:border-border-default rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-surface-raised text-sm"
                        disabled={state === "refining"}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleRefine();
                          }
                        }}
                      />
                      <button
                        onClick={handleRefine}
                        disabled={
                          !refinementInput.trim() || state === "refining"
                        }
                        className="px-4 py-2 bg-surface-raised hover:bg-surface-raised/80 disabled:bg-surface-raised disabled:text-text-muted dark:disabled:bg-surface-raised text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        {state === "refining" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        Refine
                      </button>
                    </div>
                  </div>
                </div>

                {/* Accept/Reject Buttons */}
                <div className="p-6 border-t border-border-subtle dark:border-border-default flex gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 border border-border-default dark:border-border-default text-text-secondary dark:text-text-secondary rounded-lg font-medium hover:bg-surface-raised/50 dark:hover:bg-surface-raised transition-colors"
                    data-ui-id="dialog-ai-generation-cancel-btn"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAccept}
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    data-ui-id="dialog-ai-generation-confirm-btn"
                  >
                    <Check className="w-5 h-5" />
                    Accept Workflow
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-sm">
                  {state === "generating" ? (
                    <>
                      <Loader2 className="w-12 h-12 animate-spin text-purple-600 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-text-primary dark:text-white mb-2">
                        Generating Workflow
                      </h3>
                      <p className="text-sm text-text-muted dark:text-text-muted">
                        AI is analyzing your description and creating the
                        optimal workflow...
                      </p>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-12 h-12 text-text-muted mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-text-primary dark:text-white mb-2">
                        No Workflow Generated Yet
                      </h3>
                      <p className="text-sm text-text-muted dark:text-text-muted">
                        Describe your workflow and click Generate to see results
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
