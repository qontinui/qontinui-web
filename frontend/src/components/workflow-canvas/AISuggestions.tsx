/**
 * AI Suggestions Panel - Context-aware workflow improvements
 *
 * Features:
 * - Automatically suggests improvements based on current workflow
 * - Quick-add suggested actions
 * - Explain suggestion on hover
 * - Accept/Dismiss buttons
 * - Categorized by type (optimization, error handling, etc.)
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  Lightbulb,
  X,
  Plus,
  Info,
  Zap,
  Shield,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
} from "lucide-react";
import { getMCPClient } from "../../services/mcp-client";
import type { WorkflowSuggestion } from "../../services/mcp-client";
import type { Workflow } from "../../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

interface AISuggestionsProps {
  workflow: Workflow | null;
  onApplySuggestion: (suggestion: WorkflowSuggestion) => void;
  onClose?: () => void;
  position?: "sidebar" | "floating";
}

const SUGGESTION_ICONS = {
  optimization: Zap,
  error_handling: Shield,
  missing_action: AlertTriangle,
  improvement: TrendingUp,
  alternative: Lightbulb,
};

const SUGGESTION_COLORS = {
  optimization: "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30",
  error_handling: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
  missing_action: "text-red-600 bg-red-100 dark:bg-red-900/30",
  improvement: "text-green-600 bg-green-100 dark:bg-green-900/30",
  alternative: "text-purple-600 bg-purple-100 dark:bg-purple-900/30",
};

// ============================================================================
// Component
// ============================================================================

export function AISuggestions({
  workflow,
  onApplySuggestion,
  onClose,
  position = "sidebar",
}: AISuggestionsProps) {
  const [suggestions, setSuggestions] = useState<WorkflowSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSuggestion, setExpandedSuggestion] = useState<string | null>(
    null
  );
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(
    new Set()
  );

  const mcpClient = getMCPClient();

  // Load suggestions when workflow changes
  useEffect(() => {
    if (!workflow || workflow.actions.length === 0) {
      setSuggestions([]);
      return;
    }

    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow]);

  const loadSuggestions = useCallback(async () => {
    if (!workflow) return;

    setLoading(true);
    setError(null);

    try {
      const results = await mcpClient.getSuggestions(workflow);
      setSuggestions(results);
    } catch (err) {
      console.error("Failed to load suggestions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load suggestions"
      );
    } finally {
      setLoading(false);
    }
  }, [workflow, mcpClient]);

  const handleApply = useCallback(
    (suggestion: WorkflowSuggestion) => {
      onApplySuggestion(suggestion);
      setAppliedSuggestions((prev) => new Set(prev).add(suggestion.id));
    },
    [onApplySuggestion]
  );

  const handleDismiss = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  }, []);

  const toggleExpanded = useCallback((suggestionId: string) => {
    setExpandedSuggestion((prev) =>
      prev === suggestionId ? null : suggestionId
    );
  }, []);

  // Group suggestions by type
  const groupedSuggestions = suggestions.reduce(
    (acc, suggestion) => {
      if (!acc[suggestion.type]) {
        acc[suggestion.type] = [];
      }
      acc[suggestion.type]?.push(suggestion);
      return acc;
    },
    {} as Record<string, WorkflowSuggestion[]>
  );

  // Sort by impact
  const sortedTypes = Object.keys(groupedSuggestions).sort((a, b) => {
    const impactOrder = { high: 0, medium: 1, low: 2 };
    const aGroup = groupedSuggestions[a];
    const bGroup = groupedSuggestions[b];
    if (!aGroup || !bGroup) return 0;
    const aImpact = Math.min(...aGroup.map((s) => impactOrder[s.impact]));
    const bImpact = Math.min(...bGroup.map((s) => impactOrder[s.impact]));
    return aImpact - bImpact;
  });

  const containerClass =
    position === "floating"
      ? "fixed bottom-4 right-4 w-96 max-h-[600px] bg-white dark:bg-surface-canvas rounded-lg shadow-2xl border border-border-default dark:border-border-default"
      : "w-full h-full bg-white dark:bg-surface-canvas border-l border-border-default dark:border-border-default";

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default dark:border-border-default">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-500" />
          <h3 className="font-semibold text-text-primary dark:text-white">
            AI Suggestions
          </h3>
          {suggestions.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
              {suggestions.length}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-raised dark:hover:bg-surface-raised rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Content */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: "calc(100% - 60px)" }}
      >
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-border-default border-t-purple-600 mb-4" />
            <p className="text-sm text-text-muted dark:text-text-muted">
              Analyzing workflow...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={loadSuggestions}
              className="mt-2 text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h4 className="font-medium text-text-primary dark:text-white mb-2">
              Looking Good!
            </h4>
            <p className="text-sm text-text-muted dark:text-text-muted">
              No suggestions at the moment. Your workflow looks solid.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {sortedTypes.map((type) => (
              <div key={type}>
                <h4 className="text-xs font-semibold text-text-muted dark:text-text-muted uppercase tracking-wider mb-3">
                  {type.replace("_", " ")}
                </h4>
                <div className="space-y-3">
                  {groupedSuggestions[type]?.map((suggestion) => {
                    const Icon = SUGGESTION_ICONS[suggestion.type] || Lightbulb;
                    const isExpanded = expandedSuggestion === suggestion.id;
                    const isApplied = appliedSuggestions.has(suggestion.id);

                    return (
                      <div
                        key={suggestion.id}
                        className={`border rounded-lg transition-all ${
                          isApplied
                            ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20"
                            : "border-border-default dark:border-border-default bg-surface-raised dark:bg-surface-raised"
                        }`}
                      >
                        <div className="p-3">
                          <div className="flex items-start gap-3">
                            <div
                              className={`p-2 rounded-lg ${SUGGESTION_COLORS[suggestion.type]}`}
                            >
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <h5 className="font-medium text-sm text-text-primary dark:text-white">
                                  {suggestion.title}
                                </h5>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded ${
                                      suggestion.impact === "high"
                                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                                        : suggestion.impact === "medium"
                                          ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                                          : "bg-surface-raised dark:bg-surface-raised text-text-muted dark:text-text-muted"
                                    }`}
                                  >
                                    {suggestion.impact}
                                  </span>
                                  <span className="text-xs text-text-muted dark:text-text-muted">
                                    {Math.round(suggestion.confidence * 100)}%
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-text-muted dark:text-text-muted mb-3">
                                {suggestion.description}
                              </p>

                              {isExpanded && suggestion.actions && (
                                <div className="mb-3 p-2 bg-white dark:bg-surface-canvas rounded border border-border-default dark:border-border-default">
                                  <h6 className="text-xs font-medium text-text-secondary dark:text-text-secondary mb-2">
                                    Changes:
                                  </h6>
                                  <ul className="space-y-1">
                                    {suggestion.actions.map((action, i) => (
                                      <li
                                        key={i}
                                        className="text-xs text-text-muted dark:text-text-muted flex items-start gap-2"
                                      >
                                        <span className="text-text-muted dark:text-text-muted">
                                          •
                                        </span>
                                        <span>
                                          <span className="font-medium capitalize">
                                            {action.type}
                                          </span>
                                          {action.action &&
                                            `: ${action.action.type}`}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                {!isApplied ? (
                                  <>
                                    <button
                                      onClick={() => handleApply(suggestion)}
                                      className="flex-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded transition-colors flex items-center justify-center gap-1"
                                    >
                                      <Plus className="w-3 h-3" />
                                      Apply
                                    </button>
                                    <button
                                      onClick={() =>
                                        toggleExpanded(suggestion.id)
                                      }
                                      className="px-3 py-1.5 bg-surface-raised dark:bg-surface-raised hover:bg-surface-raised/80 dark:hover:bg-surface-raised text-text-secondary dark:text-text-secondary text-xs font-medium rounded transition-colors flex items-center gap-1"
                                    >
                                      <Info className="w-3 h-3" />
                                      {isExpanded ? "Less" : "More"}
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleDismiss(suggestion.id)
                                      }
                                      className="p-1.5 hover:bg-surface-raised dark:hover:bg-surface-raised rounded transition-colors"
                                      title="Dismiss"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <div className="flex-1 flex items-center justify-center gap-2 text-green-600 dark:text-green-400 text-xs font-medium">
                                    <CheckCircle className="w-4 h-4" />
                                    Applied
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
