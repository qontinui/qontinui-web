import React from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import {
  PROMPT_TEMPLATES,
  type PromptTemplate,
} from "../../../services/prompt-templates";
import type { Workflow } from "../../../lib/action-schema/action-types";
import type { GenerationState } from "../AIGenerationDialog.types";

interface AIGenerationInputPanelProps {
  description: string;
  setDescription: (value: string) => void;
  state: GenerationState;
  error: string | null;
  showExamples: boolean;
  useExistingWorkflow: boolean;
  setUseExistingWorkflow: (value: boolean) => void;
  selectedTemplates: string[];
  toggleTemplate: (templateId: string) => void;
  existingWorkflow?: Workflow;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
  onGenerate: () => void;
  onTemplateSelect: (template: PromptTemplate) => void;
}

export function AIGenerationInputPanel({
  description,
  setDescription,
  state,
  error,
  showExamples,
  useExistingWorkflow,
  setUseExistingWorkflow,
  selectedTemplates,
  toggleTemplate,
  existingWorkflow,
  textAreaRef,
  onGenerate,
  onTemplateSelect,
}: AIGenerationInputPanelProps) {
  return (
    <div className="w-1/2 border-r border-border-subtle dark:border-border-default flex flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div>
          <label
            htmlFor="agd-description"
            className="block text-sm font-medium text-text-secondary dark:text-text-secondary mb-2"
          >
            Workflow Description
          </label>
          <textarea
            id="agd-description"
            ref={textAreaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Example: Create a workflow that logs into Gmail by clicking the login button and typing my credentials..."
            className="w-full h-48 px-4 py-3 border border-border-default dark:border-border-default rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none bg-white dark:bg-surface-raised text-text-primary dark:text-white"
            disabled={state === "generating" || state === "refining"}
          />
          <div className="mt-2 text-xs text-text-muted dark:text-text-muted">
            {description.length} characters
          </div>
        </div>

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
                Extend existing workflow ({existingWorkflow.actions.length}{" "}
                actions)
              </span>
            </label>
          )}

          <div>
            <p className="block text-xs text-text-muted dark:text-text-muted mb-2">
              Use Templates
            </p>
            <div className="flex flex-wrap gap-2">
              {["web_scraping", "automation", "data_processing", "testing"].map(
                (templateId) => (
                  <button
                    key={templateId}
                    onClick={() => toggleTemplate(templateId)}
                    className={`px-3 py-1 text-xs rounded-full transition-colors ${
                      selectedTemplates.includes(templateId)
                        ? "bg-purple-600 text-white"
                        : "bg-surface-raised/50 dark:bg-surface-raised text-text-muted dark:text-text-muted hover:bg-surface-raised dark:hover:bg-surface-raised/80"
                    }`}
                  >
                    {templateId.replace("_", " ")}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

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
                    onClick={() => onTemplateSelect(template)}
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

      <div className="p-6 border-t border-border-subtle dark:border-border-default">
        <button
          onClick={onGenerate}
          disabled={
            !description.trim() ||
            state === "generating" ||
            state === "refining"
          }
          className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-surface-raised disabled:text-text-muted dark:disabled:bg-surface-raised text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
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
  );
}
