"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Settings, FileCode } from "lucide-react";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { PromptTemplateEditor } from "./PromptTemplateEditor";
import type { LogSourceSelection } from "@/types/unified-workflow";

// =============================================================================
// Provider / Model Configuration
// =============================================================================

const PROVIDER_OPTIONS = [
  { value: "", label: "Use Default (from Settings)" },
  { value: "claude_cli", label: "Claude CLI" },
  { value: "anthropic_api", label: "Anthropic API" },
  { value: "openai_api", label: "OpenAI API" },
  { value: "gemini_api", label: "Gemini API" },
];

const MODELS_BY_PROVIDER: Record<
  string,
  Array<{ value: string; label: string }>
> = {
  claude_cli: [
    { value: "", label: "Default" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  ],
  anthropic_api: [
    { value: "", label: "Default" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  ],
  openai_api: [
    { value: "", label: "Default" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o1", label: "o1" },
    { value: "o1-mini", label: "o1-mini" },
  ],
  gemini_api: [
    { value: "", label: "Default" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Fast)" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

// =============================================================================
// Log Source Helpers
// =============================================================================

function getLogSourceValue(selection: LogSourceSelection | undefined): string {
  if (!selection) return "default";
  if (typeof selection === "string") return selection;
  if (typeof selection === "object" && "profile_id" in selection) {
    return `profile:${selection.profile_id}`;
  }
  return "default";
}

function parseLogSourceValue(value: string): LogSourceSelection | undefined {
  if (value === "default") return undefined;
  if (value === "ai" || value === "all") return value;
  if (value.startsWith("profile:")) {
    return { profile_id: value.slice("profile:".length) };
  }
  return undefined;
}

// =============================================================================
// Component
// =============================================================================

export function SettingsPanel() {
  const { state, updateWorkflow, features } = useWorkflowBuilder();
  const workflow = state.workflow;
  const [isOpen, setIsOpen] = React.useState(true);
  const [isPromptTemplateOpen, setIsPromptTemplateOpen] = React.useState(false);

  const selectClass =
    "w-full h-9 px-3 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-600";

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
            <Settings className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">
              Workflow Settings
            </span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Name
              </label>
              <Input
                className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                placeholder="Workflow name"
                value={workflow.name}
                onChange={(e) => updateWorkflow({ name: e.target.value })}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Description
              </label>
              <Textarea
                className="min-h-[60px] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                placeholder="What this workflow does..."
                value={workflow.description}
                onChange={(e) =>
                  updateWorkflow({ description: e.target.value })
                }
              />
            </div>

            {/* Category & Tags */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Category
                </label>
                <Input
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder="general"
                  value={workflow.category}
                  onChange={(e) => updateWorkflow({ category: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Tags
                </label>
                <Input
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                  placeholder="Comma-separated"
                  value={workflow.tags.join(", ")}
                  onChange={(e) =>
                    updateWorkflow({
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </div>

            {/* Iteration settings (only if agentic steps exist) */}
            {features.showIterationSettings && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Max Iterations
                  </label>
                  <Input
                    type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    value={workflow.max_iterations ?? ""}
                    onChange={(e) =>
                      updateWorkflow({
                        max_iterations: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    AI Timeout (seconds)
                  </label>
                  <Input
                    type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                    placeholder="No timeout"
                    value={workflow.timeout_seconds ?? ""}
                    onChange={(e) =>
                      updateWorkflow({
                        timeout_seconds: e.target.value
                          ? parseInt(e.target.value)
                          : null,
                      })
                    }
                  />
                </div>
              </div>
            )}

            {/* AI Provider / Model (dropdowns) */}
            {features.hasAiPrompts && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    AI Provider
                  </label>
                  <select
                    className={selectClass}
                    value={workflow.provider ?? ""}
                    onChange={(e) =>
                      updateWorkflow({
                        provider: e.target.value || undefined,
                        model: undefined,
                      })
                    }
                  >
                    {PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    AI Model
                  </label>
                  {workflow.provider &&
                  MODELS_BY_PROVIDER[workflow.provider] ? (
                    <select
                      className={selectClass}
                      value={workflow.model ?? ""}
                      onChange={(e) =>
                        updateWorkflow({ model: e.target.value || undefined })
                      }
                    >
                      {MODELS_BY_PROVIDER[workflow.provider]!.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      placeholder="Default"
                      value={workflow.model ?? ""}
                      onChange={(e) =>
                        updateWorkflow({ model: e.target.value || undefined })
                      }
                    />
                  )}
                </div>
              </div>
            )}

            {/* Log Source Selection */}
            {features.showIterationSettings && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Log Sources
                </label>
                <select
                  className={selectClass}
                  value={getLogSourceValue(workflow.log_source_selection)}
                  onChange={(e) =>
                    updateWorkflow({
                      log_source_selection: parseLogSourceValue(e.target.value),
                    })
                  }
                >
                  <option value="default">
                    Default (from global settings)
                  </option>
                  <option value="ai">AI-based selection</option>
                  <option value="all">All enabled sources</option>
                </select>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Controls which log files are monitored during execution
                </p>
              </div>
            )}

            {/* Prompt template editor button (only when agentic steps exist) */}
            {features.showIterationSettings && (
              <div>
                <button
                  onClick={() => setIsPromptTemplateOpen(true)}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
                >
                  <FileCode className="w-4 h-4 text-amber-400" />
                  <span>Edit Prompt Template</span>
                  {workflow.prompt_template && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      Custom
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Toggle options */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={workflow.log_watch_enabled !== false}
                  onChange={(e) =>
                    updateWorkflow({ log_watch_enabled: e.target.checked })
                  }
                />
                Enable log watching
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={workflow.health_check_enabled !== false}
                  onChange={(e) =>
                    updateWorkflow({ health_check_enabled: e.target.checked })
                  }
                />
                Enable health checks
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={workflow.skip_ai_summary !== true}
                  onChange={(e) =>
                    updateWorkflow({ skip_ai_summary: !e.target.checked })
                  }
                />
                Generate AI summary
              </label>
            </div>

            {/* Health check URLs */}
            {workflow.health_check_enabled !== false && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Health Check URLs
                </label>
                {(workflow.health_check_urls ?? []).map((hc, i) => (
                  <div key={i} className="flex gap-2 mb-1">
                    <Input
                      className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      placeholder="Name"
                      value={hc.name}
                      onChange={(e) => {
                        const urls = (workflow.health_check_urls ?? []).map(
                          (item, j) =>
                            j === i
                              ? { name: e.target.value, url: item.url }
                              : item
                        );
                        updateWorkflow({ health_check_urls: urls });
                      }}
                    />
                    <Input
                      className="flex-[2] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
                      placeholder="URL"
                      value={hc.url}
                      onChange={(e) => {
                        const urls = (workflow.health_check_urls ?? []).map(
                          (item, j) =>
                            j === i
                              ? { name: item.name, url: e.target.value }
                              : item
                        );
                        updateWorkflow({ health_check_urls: urls });
                      }}
                    />
                    <button
                      className="text-red-400 hover:text-red-300 text-sm px-1"
                      onClick={() => {
                        const urls = (workflow.health_check_urls ?? []).filter(
                          (_, j) => j !== i
                        );
                        updateWorkflow({ health_check_urls: urls });
                      }}
                    >
                      x
                    </button>
                  </div>
                ))}
                <button
                  className="text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => {
                    const urls = [
                      ...(workflow.health_check_urls ?? []),
                      { name: "", url: "" },
                    ];
                    updateWorkflow({ health_check_urls: urls });
                  }}
                >
                  + Add health check URL
                </button>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>

      <PromptTemplateEditor
        isOpen={isPromptTemplateOpen}
        onClose={() => setIsPromptTemplateOpen(false)}
      />
    </Collapsible>
  );
}
