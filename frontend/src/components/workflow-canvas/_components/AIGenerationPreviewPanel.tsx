import React from "react";
import {
  Loader2,
  Check,
  RefreshCw,
  Copy,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import type { GeneratedWorkflow } from "../../../services/mcp-client";
import type { Workflow } from "../../../lib/action-schema/action-types";
import type { GenerationState } from "../AIGenerationDialog.types";

interface AIGenerationPreviewPanelProps {
  state: GenerationState;
  result: GeneratedWorkflow | null;
  currentWorkflow?: Workflow;
  confidence?: number;
  selectedAlternative: number | null;
  setSelectedAlternative: (index: number) => void;
  refinementInput: string;
  setRefinementInput: (value: string) => void;
  onRefine: () => void;
  onAccept: () => void;
  onClose: () => void;
}

export function AIGenerationPreviewPanel({
  state,
  result,
  currentWorkflow,
  confidence,
  selectedAlternative,
  setSelectedAlternative,
  refinementInput,
  setRefinementInput,
  onRefine,
  onAccept,
  onClose,
}: AIGenerationPreviewPanelProps) {
  if (!result) {
    return (
      <div className="w-1/2 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            {state === "generating" ? (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-purple-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary dark:text-white mb-2">
                  Generating Workflow
                </h3>
                <p className="text-sm text-text-muted dark:text-text-muted">
                  AI is analyzing your description and creating the optimal
                  workflow...
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
      </div>
    );
  }

  return (
    <div className="w-1/2 flex flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
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

        <div>
          <h3 className="text-sm font-medium text-text-secondary dark:text-text-secondary mb-2">
            Explanation
          </h3>
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-900 dark:text-blue-300">
            {result.explanation}
          </div>
        </div>

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
                  onRefine();
                }
              }}
            />
            <button
              onClick={onRefine}
              disabled={!refinementInput.trim() || state === "refining"}
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

      <div className="p-6 border-t border-border-subtle dark:border-border-default flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-3 border border-border-default dark:border-border-default text-text-secondary dark:text-text-secondary rounded-lg font-medium hover:bg-surface-raised/50 dark:hover:bg-surface-raised transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Check className="w-5 h-5" />
          Accept Workflow
        </button>
      </div>
    </div>
  );
}
