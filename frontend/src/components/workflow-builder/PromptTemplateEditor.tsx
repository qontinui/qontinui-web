"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCode, RotateCcw, Info } from "lucide-react";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import {
  TEMPLATE_VARIABLES,
  DEFAULT_UNIFIED_PROMPT_TEMPLATE,
  getGlobalPromptTemplate,
  saveGlobalPromptTemplate,
  resetGlobalPromptTemplate,
  isUsingGlobalCustomTemplate,
} from "./prompt-template-constants";

// =============================================================================
// Types
// =============================================================================

type PromptTemplateScope = "global" | "workflow";

interface PromptTemplateEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function PromptTemplateEditor({
  isOpen,
  onClose,
}: PromptTemplateEditorProps) {
  const { state, updateWorkflow } = useWorkflowBuilder();
  const workflowTemplate = state.workflow.prompt_template;
  const isUsingWorkflowTemplate =
    workflowTemplate !== null && workflowTemplate !== undefined;

  // Scope state
  const [activeScope, setActiveScope] = useState<PromptTemplateScope>(
    isUsingWorkflowTemplate ? "workflow" : "global"
  );

  // Editor content
  const [template, setTemplate] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Textarea ref for cursor-position insertion
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Show/hide variable info
  const [showVariableInfo, setShowVariableInfo] = useState(false);

  // Initialize editor content when dialog opens or scope changes
  useEffect(() => {
    if (!isOpen) return;
    if (activeScope === "workflow") {
      setTemplate(workflowTemplate || getGlobalPromptTemplate());
    } else {
      setTemplate(getGlobalPromptTemplate());
    }
    setHasChanges(false);
  }, [isOpen, activeScope, workflowTemplate]);

  // Insert a variable token at the current cursor position in the textarea
  const insertVariable = useCallback(
    (token: string) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        // Fallback: append to end
        setTemplate((prev) => prev + token);
        setHasChanges(true);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = template.slice(0, start);
      const after = template.slice(end);
      const newValue = before + token + after;

      setTemplate(newValue);
      setHasChanges(true);

      // Restore cursor position after the inserted token
      requestAnimationFrame(() => {
        textarea.focus();
        const cursorPos = start + token.length;
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [template]
  );

  // Save the template
  const handleSave = useCallback(() => {
    if (activeScope === "workflow") {
      updateWorkflow({ prompt_template: template || null });
    } else {
      // If the user saved the exact default text, clear the override instead
      if (template === DEFAULT_UNIFIED_PROMPT_TEMPLATE) {
        resetGlobalPromptTemplate();
      } else {
        saveGlobalPromptTemplate(template);
      }
    }
    setHasChanges(false);
    onClose();
  }, [activeScope, template, updateWorkflow, onClose]);

  // Reset to default
  const handleResetToDefault = useCallback(() => {
    if (activeScope === "workflow") {
      // Reset workflow template -- revert to global
      setTemplate(getGlobalPromptTemplate());
    } else {
      // Reset global to the built-in default
      setTemplate(DEFAULT_UNIFIED_PROMPT_TEMPLATE);
    }
    setHasChanges(true);
  }, [activeScope]);

  // Clear the workflow-level template (remove override)
  const handleClearWorkflowTemplate = useCallback(() => {
    updateWorkflow({ prompt_template: null });
    setActiveScope("global");
    setTemplate(getGlobalPromptTemplate());
    setHasChanges(false);
  }, [updateWorkflow]);

  // Scope change
  const handleScopeChange = useCallback(
    (scope: PromptTemplateScope) => {
      // If there are unsaved changes, don't silently discard them
      if (hasChanges) {
        const confirmed = window.confirm(
          "You have unsaved changes. Switching tabs will discard them. Continue?"
        );
        if (!confirmed) return;
      }
      setActiveScope(scope);
    },
    [hasChanges]
  );

  // Cancel handler
  const handleCancel = useCallback(() => {
    setHasChanges(false);
    onClose();
  }, [onClose]);

  const charCount = template.length;
  const isCustomGlobal = isUsingGlobalCustomTemplate();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-amber-400" />
            Prompt Template Editor
          </DialogTitle>
          <DialogDescription>
            Customize the system prompt template used when running agentic
            workflows. This controls how the AI operates during the iterative
            feedback loop.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Scope tabs */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleScopeChange("global")}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeScope === "global"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-transparent"
              }`}
            >
              Global Default
              {isCustomGlobal && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  (customized)
                </span>
              )}
            </button>
            <button
              onClick={() => handleScopeChange("workflow")}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeScope === "workflow"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-transparent"
              }`}
            >
              This Workflow
              {isUsingWorkflowTemplate && (
                <span className="ml-1.5 text-[10px] opacity-70">(custom)</span>
              )}
            </button>
          </div>

          {/* Scope description */}
          <p className="text-xs text-zinc-500 bg-zinc-800/30 rounded-md p-2">
            {activeScope === "global" ? (
              <>
                <strong className="text-zinc-400">Global template</strong> is
                used by all workflows that do not have a custom template.
                Changes here affect all workflows without overrides.
              </>
            ) : (
              <>
                <strong className="text-zinc-400">Workflow template</strong>{" "}
                {isUsingWorkflowTemplate
                  ? "overrides the global template for this workflow only."
                  : "is not set. Editing here will create a custom template for this workflow."}
              </>
            )}
          </p>

          {/* Template variables as clickable chips */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs font-medium text-zinc-400">
                Insert Variable
              </label>
              <button
                onClick={() => setShowVariableInfo(!showVariableInfo)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Toggle variable descriptions"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.name}
                  onClick={() => insertVariable(v.token)}
                  className="group relative"
                  title={v.description}
                >
                  <Badge
                    variant="outline"
                    className="cursor-pointer hover:bg-amber-500/20 hover:text-amber-400 hover:border-amber-500/30 transition-colors font-mono text-[11px]"
                  >
                    {v.token}
                  </Badge>
                </button>
              ))}
            </div>
            {showVariableInfo && (
              <div className="mt-2 p-2 bg-zinc-800/50 rounded-md text-xs space-y-1">
                {TEMPLATE_VARIABLES.map((v) => (
                  <div key={v.name} className="flex items-start gap-2">
                    <code className="text-amber-400 whitespace-nowrap font-mono">
                      {v.token}
                    </code>
                    <span className="text-zinc-400">{v.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Textarea editor */}
          <div>
            <textarea
              ref={textareaRef}
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                setHasChanges(true);
              }}
              className="w-full h-72 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-200 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="Enter your prompt template..."
              spellCheck={false}
            />
            <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
              <span>{charCount} characters</span>
              {hasChanges && (
                <span className="text-amber-400">Unsaved changes</span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="flex-row justify-between items-center border-t border-zinc-800 pt-3 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetToDefault}
              className="gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to{" "}
              {activeScope === "global" ? "Built-in Default" : "Global"}
            </Button>
            {activeScope === "workflow" && isUsingWorkflowTemplate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearWorkflowTemplate}
                className="text-red-400 hover:text-red-300"
              >
                Remove Override
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
