"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  BookOpen,
  Plus,
  X,
  Check,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { useContextsDetailed } from "@/lib/runner/hooks/library-hooks";
import type { ContextItem } from "@/lib/runner/types/exploration";

// =============================================================================
// Types
// =============================================================================

type ContextScope = "project" | "user" | "builtin";

interface AutoDetectResult {
  contextId: string;
  contextName: string;
  reason: string;
  matchedTrigger: string;
}

interface IncludedContext {
  context: ContextItem;
  isAutoIncluded: boolean;
  autoIncludeReason?: string;
}

// =============================================================================
// Helpers
// =============================================================================

const SCOPE_ORDER: ContextScope[] = ["builtin", "user", "project"];

const SCOPE_VARIANT: Record<ContextScope, "info" | "success" | "default"> = {
  builtin: "info",
  user: "success",
  project: "default",
};

function groupByScope(
  items: ContextItem[]
): Record<ContextScope, ContextItem[]> {
  return {
    builtin: items.filter((c) => c.scope === "builtin"),
    user: items.filter((c) => c.scope === "user"),
    project: items.filter((c) => c.scope === "project"),
  };
}

/**
 * Client-side auto-include evaluation.
 * Checks the workflow description against each context's taskMentions triggers.
 */
function evaluateAutoInclude(
  description: string,
  contexts: ContextItem[]
): AutoDetectResult[] {
  if (!description.trim()) return [];

  const descLower = description.toLowerCase();
  const results: AutoDetectResult[] = [];

  for (const ctx of contexts) {
    if (ctx.enabled === false) continue;
    const mentions = ctx.autoInclude?.taskMentions;
    if (!mentions || mentions.length === 0) continue;

    for (const mention of mentions) {
      if (mention && descLower.includes(mention.toLowerCase())) {
        results.push({
          contextId: ctx.id,
          contextName: ctx.name,
          reason: "taskMention",
          matchedTrigger: mention,
        });
        break;
      }
    }
  }

  return results;
}

// =============================================================================
// Component
// =============================================================================

export function ContextManagement() {
  const { state, updateWorkflow } = useWorkflowBuilder();
  const { workflow } = state;
  const {
    data: contexts,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useContextsDetailed();

  // UI state
  const [isOpen, setIsOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Workflow context fields
  const contextIds = useMemo(
    () => workflow.context_ids ?? [],
    [workflow.context_ids]
  );
  const disabledContextIds = useMemo(
    () => new Set(workflow.disabled_context_ids ?? []),
    [workflow.disabled_context_ids]
  );
  const autoIncludeEnabled = workflow.auto_include_contexts ?? true;

  // ---------------------------------------------------------------------------
  // Auto-detect contexts based on workflow description
  // ---------------------------------------------------------------------------

  const autoDetectedContexts = useMemo(() => {
    if (!autoIncludeEnabled || !contexts) return [];
    return evaluateAutoInclude(workflow.description, contexts);
  }, [workflow.description, contexts, autoIncludeEnabled]);

  // ---------------------------------------------------------------------------
  // Context manipulation
  // ---------------------------------------------------------------------------

  const addContext = useCallback(
    (contextId: string) => {
      if (!contextIds.includes(contextId)) {
        updateWorkflow({ context_ids: [...contextIds, contextId] });
      }
      setShowPicker(false);
      setSearchQuery("");
    },
    [contextIds, updateWorkflow]
  );

  const removeContext = useCallback(
    (contextId: string) => {
      updateWorkflow({
        context_ids: contextIds.filter((id) => id !== contextId),
      });
    },
    [contextIds, updateWorkflow]
  );

  const toggleContextDisabled = useCallback(
    (contextId: string) => {
      const disabled = new Set(disabledContextIds);
      if (disabled.has(contextId)) {
        disabled.delete(contextId);
      } else {
        disabled.add(contextId);
      }
      updateWorkflow({ disabled_context_ids: Array.from(disabled) });
    },
    [disabledContextIds, updateWorkflow]
  );

  const handleToggle = useCallback(
    (contextId: string, isAutoIncluded: boolean) => {
      if (isAutoIncluded) {
        toggleContextDisabled(contextId);
      } else {
        removeContext(contextId);
      }
    },
    [toggleContextDisabled, removeContext]
  );

  const setAutoInclude = useCallback(
    (value: boolean) => {
      updateWorkflow({ auto_include_contexts: value });
    },
    [updateWorkflow]
  );

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const includedContexts = useMemo((): IncludedContext[] => {
    if (!contexts) return [];
    const result: IncludedContext[] = [];

    // Auto-detected contexts (not disabled)
    for (const autoResult of autoDetectedContexts) {
      if (disabledContextIds.has(autoResult.contextId)) continue;
      const ctx = contexts.find((c) => c.id === autoResult.contextId);
      if (ctx) {
        result.push({
          context: ctx,
          isAutoIncluded: true,
          autoIncludeReason: `${autoResult.reason}: "${autoResult.matchedTrigger}"`,
        });
      }
    }

    // Manually added contexts
    for (const id of contextIds) {
      if (result.some((r) => r.context.id === id)) continue;
      const ctx = contexts.find((c) => c.id === id);
      if (ctx) {
        result.push({
          context: ctx,
          isAutoIncluded: false,
        });
      }
    }

    return result;
  }, [contexts, autoDetectedContexts, contextIds, disabledContextIds]);

  // Disabled auto-include contexts (for display)
  const disabledAutoContexts = useMemo(() => {
    if (!contexts || !autoIncludeEnabled) return [];
    return autoDetectedContexts
      .filter((a) => disabledContextIds.has(a.contextId))
      .map((a) => contexts.find((c) => c.id === a.contextId))
      .filter((c): c is ContextItem => c != null);
  }, [contexts, autoDetectedContexts, disabledContextIds, autoIncludeEnabled]);

  // Available contexts for the picker dropdown
  const availableForPicker = useMemo(() => {
    if (!contexts) return [];
    const includedIds = new Set(includedContexts.map((c) => c.context.id));
    return contexts
      .filter((c) => !includedIds.has(c.id) && c.enabled !== false)
      .filter((c) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.content.toLowerCase().includes(q) ||
          c.category?.toLowerCase().includes(q) ||
          c.tags?.some((t) => t.toLowerCase().includes(q))
        );
      });
  }, [contexts, includedContexts, searchQuery]);

  const groupedAvailable = useMemo(
    () => groupByScope(availableForPicker),
    [availableForPicker]
  );

  // Close picker on click outside
  const pickerRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const totalCount = includedContexts.length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <BookOpen className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">
              AI Contexts
            </span>
            {totalCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-auto text-[10px] px-1.5 py-0"
              >
                {totalCount}
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {/* Loading */}
            {isLoading && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading contexts...
              </div>
            )}

            {/* Error / offline */}
            {(error || isOffline) && (
              <div className="flex items-center gap-2 text-sm py-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="flex-1 text-red-400">
                  {isOffline
                    ? "Runner not connected"
                    : (error ?? "Failed to load contexts")}
                </span>
                <button
                  className="text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => refetch()}
                >
                  Retry
                </button>
              </div>
            )}

            {/* Auto-include toggle */}
            {!isLoading && (
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="cm-auto-include"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      id="cm-auto-include"
                      checked={autoIncludeEnabled}
                      onCheckedChange={(checked) =>
                        setAutoInclude(checked === true)
                      }
                    />
                    <span className="text-sm text-zinc-400">
                      Auto-include contexts
                    </span>
                  </label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-zinc-500 hover:text-zinc-300 cursor-help">
                          <Lightbulb className="w-3.5 h-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="max-w-[260px] text-xs"
                      >
                        Automatically includes contexts based on keywords in
                        your workflow description. Disable to only use manually
                        added contexts.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !error && includedContexts.length === 0 && (
              <p className="text-sm text-zinc-500 italic py-1">
                No contexts selected. Add contexts manually
                {autoIncludeEnabled
                  ? " or set a description to trigger auto-include."
                  : "."}
              </p>
            )}

            {/* Included contexts list */}
            {!isLoading && includedContexts.length > 0 && (
              <div className="space-y-1.5">
                {includedContexts.map(
                  ({ context, isAutoIncluded, autoIncludeReason }) => (
                    <div
                      key={context.id}
                      className="flex items-start gap-2 p-2 rounded-md border border-zinc-800 hover:border-zinc-700 transition-colors group"
                    >
                      <button
                        onClick={() => handleToggle(context.id, isAutoIncluded)}
                        className="mt-0.5 text-green-500 hover:text-red-400 transition-colors"
                        title={
                          isAutoIncluded
                            ? "Disable this auto-included context"
                            : "Remove this context"
                        }
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm text-zinc-200 truncate">
                            {context.name}
                          </span>
                          {context.scope && (
                            <Badge
                              variant={
                                SCOPE_VARIANT[context.scope as ContextScope] ??
                                "default"
                              }
                              className="text-[10px] px-1.5 py-0 shrink-0"
                            >
                              {context.scope}
                            </Badge>
                          )}
                          {context.category && (
                            <span className="text-[10px] text-zinc-500">
                              {context.category}
                            </span>
                          )}
                        </div>
                        {autoIncludeReason && (
                          <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
                            <Lightbulb className="w-3 h-3 text-yellow-500 shrink-0" />
                            Auto: {autoIncludeReason}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            {/* Disabled auto-include contexts */}
            {!isLoading && disabledAutoContexts.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-zinc-500 font-medium">
                  Disabled auto-include:
                </p>
                {disabledAutoContexts.map((ctx) => (
                  <div
                    key={ctx.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-zinc-800 border-dashed opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <button
                      onClick={() => toggleContextDisabled(ctx.id)}
                      className="text-zinc-500 hover:text-green-400 transition-colors"
                      title="Re-enable this context"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm text-zinc-400 truncate">
                      {ctx.name}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 shrink-0"
                    >
                      disabled
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Add context button + picker */}
            {!isLoading && !error && (
              <div
                className="relative pt-2 border-t border-zinc-800"
                ref={pickerRef}
              >
                <button
                  onClick={() => setShowPicker(!showPicker)}
                  className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Context
                </button>

                {showPicker && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 max-h-72 overflow-hidden">
                    {/* Search input */}
                    <div className="p-2 border-b border-zinc-700">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <Input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search contexts..."
                          className="pl-8 bg-zinc-700 border-zinc-600 text-zinc-200 text-sm h-8"
                        />
                      </div>
                    </div>

                    {/* Grouped context list */}
                    <div className="overflow-auto max-h-48">
                      {SCOPE_ORDER.map((scope) => {
                        const items = groupedAvailable[scope];
                        if (items.length === 0) return null;
                        return (
                          <div key={scope}>
                            <div className="px-3 py-1 text-[10px] font-medium text-zinc-500 bg-zinc-800/80 uppercase tracking-wider">
                              {scope}
                            </div>
                            {items.map((ctx) => (
                              <button
                                key={ctx.id}
                                onClick={() => addContext(ctx.id)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-700 transition-colors"
                              >
                                <Plus className="w-3 h-3 text-zinc-500 shrink-0" />
                                <span className="text-sm text-zinc-200 truncate flex-1">
                                  {ctx.name}
                                </span>
                                {ctx.category && (
                                  <span className="text-[10px] text-zinc-500 shrink-0">
                                    {ctx.category}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                      {availableForPicker.length === 0 && (
                        <div className="px-3 py-4 text-sm text-zinc-500 text-center">
                          {!contexts || contexts.length === 0
                            ? "No contexts available. Is the runner connected?"
                            : "No matching contexts found"}
                        </div>
                      )}
                    </div>

                    {/* Cancel */}
                    <div className="p-2 border-t border-zinc-700">
                      <button
                        onClick={() => {
                          setShowPicker(false);
                          setSearchQuery("");
                        }}
                        className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
