/**
 * Workflow Explanation Panel - AI-generated workflow description
 *
 * Features:
 * - Natural language workflow summary
 * - Step-by-step explanation
 * - Potential issues highlighted
 * - Optimization suggestions
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  FileText,
  Loader2,
  AlertTriangle,
  Lightbulb,
  RefreshCw,
  Copy,
} from "lucide-react";
import { getMCPClient } from "../../services/mcp-client";
import type { Workflow } from "../../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

interface WorkflowExplanationProps {
  workflow: Workflow;
  onClose?: () => void;
}

interface ExplanationData {
  summary: string;
  steps: Array<{
    actionId: string;
    explanation: string;
    purpose: string;
  }>;
  flowDescription: string;
  potentialIssues?: string[];
  recommendations?: string[];
}

// ============================================================================
// Component
// ============================================================================

export function WorkflowExplanation({
  workflow,
  onClose,
}: WorkflowExplanationProps) {
  const [explanation, setExplanation] = useState<ExplanationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mcpClient = getMCPClient();

  // Load explanation on mount
  useEffect(() => {
    loadExplanation();
  }, [workflow]);

  const loadExplanation = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await mcpClient.explainWorkflow(workflow);
      setExplanation(result);
    } catch (err) {
      console.error("Failed to generate explanation:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate explanation"
      );
    } finally {
      setLoading(false);
    }
  }, [workflow, mcpClient]);

  const handleCopy = useCallback(() => {
    if (!explanation) return;

    const text = `
# ${workflow.name}

${explanation.summary}

## Workflow Flow
${explanation.flowDescription}

## Step-by-Step Breakdown
${explanation.steps
  .map(
    (step, i) => `
${i + 1}. ${step.explanation}
   Purpose: ${step.purpose}
`
  )
  .join("\n")}

${
  explanation.potentialIssues && explanation.potentialIssues.length > 0
    ? `
## Potential Issues
${explanation.potentialIssues.map((issue) => `- ${issue}`).join("\n")}
`
    : ""
}

${
  explanation.recommendations && explanation.recommendations.length > 0
    ? `
## Recommendations
${explanation.recommendations.map((rec) => `- ${rec}`).join("\n")}
`
    : ""
}
    `.trim();

    navigator.clipboard.writeText(text);
  }, [explanation, workflow]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Workflow Explanation
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadExplanation}
            disabled={loading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {explanation && (
            <button
              onClick={handleCopy}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              title="Copy explanation"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-4" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Analyzing workflow...
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={loadExplanation}
              className="mt-2 text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : explanation ? (
          <>
            {/* Summary */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Summary
              </h4>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-sm text-blue-900 dark:text-blue-200">
                  {explanation.summary}
                </p>
              </div>
            </div>

            {/* Flow Description */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Workflow Flow
              </h4>
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {explanation.flowDescription}
                </p>
              </div>
            </div>

            {/* Step-by-Step */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Step-by-Step Breakdown
              </h4>
              <div className="space-y-3">
                {explanation.steps.map((step, index) => {
                  const action = workflow.actions.find(
                    (a) => a.id === step.actionId
                  );

                  return (
                    <div
                      key={step.actionId}
                      className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-l-4 border-purple-500"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h5 className="font-medium text-sm text-gray-900 dark:text-white">
                              {action?.name || action?.type}
                            </h5>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              ({action?.type})
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                            {step.explanation}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 italic">
                            Purpose: {step.purpose}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Potential Issues */}
            {explanation.potentialIssues &&
              explanation.potentialIssues.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    Potential Issues
                  </h4>
                  <div className="space-y-2">
                    {explanation.potentialIssues.map((issue, index) => (
                      <div
                        key={index}
                        className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg"
                      >
                        <p className="text-sm text-yellow-900 dark:text-yellow-200">
                          {issue}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Recommendations */}
            {explanation.recommendations &&
              explanation.recommendations.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-green-500" />
                    Recommendations
                  </h4>
                  <div className="space-y-2">
                    {explanation.recommendations.map((rec, index) => (
                      <div
                        key={index}
                        className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
                      >
                        <p className="text-sm text-green-900 dark:text-green-200">
                          {rec}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </>
        ) : null}
      </div>
    </div>
  );
}
