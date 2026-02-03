/**
 * ValidationResultsDialog Component
 *
 * Displays validation results for the entire project, showing issues
 * grouped by workflow with clickable links to navigate to problematic workflows.
 */

import React, { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  ClipboardCheck,
  Image as ImageIcon,
  Monitor,
  Workflow,
  Settings,
} from "lucide-react";
import type {
  ProjectValidationResult,
  ValidationIssue,
  IssueCategory,
} from "@/lib/project-validator";

export interface ValidationResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ProjectValidationResult | null;
  onNavigateToWorkflow: (workflowId: string) => void;
}

/**
 * Get icon for issue category
 */
function getCategoryIcon(category: IssueCategory) {
  switch (category) {
    case "workflow":
      return <Workflow className="w-3 h-3" />;
    case "monitor":
      return <Monitor className="w-3 h-3" />;
    case "image_reference":
      return <ImageIcon className="w-3 h-3" />;
    case "action_config":
      return <Settings className="w-3 h-3" />;
    case "state":
      return <Settings className="w-3 h-3" />;
    default:
      return <Settings className="w-3 h-3" />;
  }
}

/**
 * Get label for issue category
 */
function getCategoryLabel(category: IssueCategory): string {
  switch (category) {
    case "workflow":
      return "Workflow Structure";
    case "monitor":
      return "Monitor Assignment";
    case "image_reference":
      return "Missing Image";
    case "action_config":
      return "Action Configuration";
    case "state":
      return "State Configuration";
    default:
      return category;
  }
}

export function ValidationResultsDialog({
  open,
  onOpenChange,
  results,
  onNavigateToWorkflow,
}: ValidationResultsDialogProps) {
  // Group issues by category for non-workflow issues (like state/monitor issues)
  const nonWorkflowIssues = useMemo(() => {
    if (!results) return [];
    return results.issues.filter((issue) => !issue.workflowId);
  }, [results]);

  // Get workflows with issues
  const workflowsWithIssues = useMemo(() => {
    if (!results) return [];
    const result: Array<{
      workflowId: string;
      workflowName: string;
      issues: ValidationIssue[];
    }> = [];
    results.issuesByWorkflow.forEach((workflowIssues, workflowId) => {
      const firstIssue = workflowIssues[0];
      result.push({
        workflowId,
        workflowName: firstIssue?.workflowName || workflowId,
        issues: workflowIssues,
      });
    });
    return result;
  }, [results]);

  if (!results) return null;

  const { isValid, errorCount, warningCount } = results;

  const hasIssues = errorCount > 0 || warningCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-surface-canvas border-border-subtle" data-ui-id="dialog-validation-results">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-brand-primary" />
            Project Validation Results
          </DialogTitle>
          <DialogDescription>
            {isValid
              ? "Your project passed all validation checks."
              : `Found ${errorCount} error(s) and ${warningCount} warning(s) that should be addressed.`}
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div
          className={`rounded-lg p-4 border ${
            isValid
              ? "bg-green-950/30 border-green-700"
              : errorCount > 0
                ? "bg-red-950/30 border-red-700"
                : "bg-yellow-950/30 border-yellow-700"
          }`}
        >
          <div className="flex items-center gap-2">
            {isValid ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span className="text-green-400 font-medium">
                  All checks passed
                </span>
              </>
            ) : errorCount > 0 ? (
              <>
                <XCircle className="w-5 h-5 text-red-400" />
                <span className="text-red-400 font-medium">
                  {errorCount} error(s), {warningCount} warning(s)
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                <span className="text-yellow-400 font-medium">
                  {warningCount} warning(s)
                </span>
              </>
            )}
          </div>
        </div>

        {/* Issues List - scrollable */}
        {hasIssues && (
          <ScrollArea className="h-[350px]">
            <div className="space-y-4 pr-4">
              {/* Non-workflow issues (monitors, states) */}
              {nonWorkflowIssues.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-text-muted flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-red-400" />
                    General Issues
                  </h3>
                  <div className="space-y-1">
                    {nonWorkflowIssues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="bg-surface-canvas/50 rounded-lg p-3 border border-border-subtle"
                      >
                        <div className="flex items-start gap-2">
                          {issue.severity === "error" ? (
                            <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {getCategoryIcon(issue.category)}
                              <span className="text-xs text-text-muted">
                                {getCategoryLabel(issue.category)}
                              </span>
                            </div>
                            <p
                              className={`text-sm ${
                                issue.severity === "error"
                                  ? "text-red-400/90"
                                  : "text-yellow-400/90"
                              }`}
                            >
                              {issue.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Workflow Issues */}
              {workflowsWithIssues.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-text-muted flex items-center gap-2">
                    <Workflow className="w-4 h-4 text-yellow-400" />
                    Workflow Issues
                  </h3>
                  <div className="space-y-2">
                    {workflowsWithIssues.map((workflow) => {
                      const errors = workflow.issues.filter(
                        (i) => i.severity === "error"
                      );
                      const warnings = workflow.issues.filter(
                        (i) => i.severity === "warning"
                      );

                      return (
                        <div
                          key={workflow.workflowId}
                          className="bg-surface-canvas/50 rounded-lg p-3 border border-border-subtle"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white">
                              {workflow.workflowName}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                onNavigateToWorkflow(workflow.workflowId);
                                onOpenChange(false);
                              }}
                              className="h-7 px-2 text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
                              data-ui-id={`automation-validation-goto-${workflow.workflowId}-btn`}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              Go to workflow
                            </Button>
                          </div>

                          {/* Errors */}
                          {errors.length > 0 && (
                            <div className="mb-2">
                              <ul className="space-y-1">
                                {errors.map((error, idx) => (
                                  <li
                                    key={idx}
                                    className="text-xs text-red-400/80 flex items-start gap-1"
                                  >
                                    <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    <span className="flex-1">
                                      {error.message}
                                    </span>
                                    <span className="text-text-muted text-[10px]">
                                      {getCategoryLabel(error.category)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Warnings */}
                          {warnings.length > 0 && (
                            <div>
                              <ul className="space-y-1">
                                {warnings.map((warning, idx) => (
                                  <li
                                    key={idx}
                                    className="text-xs text-yellow-400/80 flex items-start gap-1"
                                  >
                                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                    <span className="flex-1">
                                      {warning.message}
                                    </span>
                                    <span className="text-text-muted text-[10px]">
                                      {getCategoryLabel(warning.category)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            className={
              isValid
                ? "bg-green-600 hover:bg-green-600/80 text-white"
                : "bg-surface-raised hover:bg-surface-raised/80 text-white"
            }
            data-ui-id="automation-validation-close-btn"
          >
            {isValid ? "Great!" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
