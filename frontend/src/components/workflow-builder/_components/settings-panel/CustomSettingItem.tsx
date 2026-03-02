import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, FileCode } from "lucide-react";
import type { CustomSettingDef } from "@qontinui/workflow-utils";
import {
  MODELS_BY_PROVIDER,
  PROVIDER_OPTIONS,
  MODEL_OVERRIDE_PHASES,
  MODEL_PRESETS,
  detectPreset,
  getLogSourceValue,
  parseLogSourceValue,
  resolveModelForPhase,
} from "@qontinui/workflow-utils";
import type {
  LogSourceSelection,
  ModelOverrideConfig,
  ModelOverrides,
} from "@/types/unified-workflow";
import type { SettingRenderProps } from "./types";

function NameInput({ workflow, updateWorkflow }: SettingRenderProps) {
  return (
    <div>
      <label
        htmlFor="sp-name"
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        Name
      </label>
      <Input
        id="sp-name"
        className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
        placeholder="Workflow name"
        value={workflow.name}
        onChange={(e) => updateWorkflow({ name: e.target.value })}
      />
    </div>
  );
}

function DescriptionInput({ workflow, updateWorkflow }: SettingRenderProps) {
  return (
    <div>
      <label
        htmlFor="sp-description"
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        Description
      </label>
      <Textarea
        id="sp-description"
        className="min-h-[60px] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
        placeholder="What this workflow does..."
        value={workflow.description}
        onChange={(e) => updateWorkflow({ description: e.target.value })}
      />
    </div>
  );
}

function CategoryInput({ workflow, updateWorkflow }: SettingRenderProps) {
  return (
    <div>
      <label
        htmlFor="sp-category"
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        Category
      </label>
      <Input
        id="sp-category"
        className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
        placeholder="general"
        value={workflow.category}
        onChange={(e) => updateWorkflow({ category: e.target.value })}
      />
    </div>
  );
}

function TagsInput({ workflow, updateWorkflow }: SettingRenderProps) {
  return (
    <div>
      <label
        htmlFor="sp-tags"
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        Tags
      </label>
      <Input
        id="sp-tags"
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
  );
}

function ModelSelect({
  workflow,
  updateWorkflow,
  selectClass,
}: SettingRenderProps) {
  const provider = workflow.provider;
  const models = provider ? MODELS_BY_PROVIDER[provider] : undefined;
  if (!provider) return null;
  return (
    <div>
      <label
        htmlFor="sp-model"
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        AI Model
      </label>
      {models ? (
        <select
          id="sp-model"
          className={selectClass}
          value={workflow.model ?? ""}
          onChange={(e) =>
            updateWorkflow({ model: e.target.value || undefined })
          }
        >
          {models.map((opt) => (
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
  );
}

function LogSourceSelect({
  workflow,
  updateWorkflow,
  selectClass,
}: SettingRenderProps) {
  return (
    <div>
      <label
        htmlFor="sp-log-sources"
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        Log Sources
      </label>
      <select
        id="sp-log-sources"
        className={selectClass}
        value={getLogSourceValue(
          workflow.log_source_selection as LogSourceSelection | undefined
        )}
        onChange={(e) =>
          updateWorkflow({
            log_source_selection: parseLogSourceValue(e.target.value),
          })
        }
      >
        <option value="default">Default (from global settings)</option>
        <option value="ai">AI-based selection</option>
        <option value="all">All enabled sources</option>
      </select>
      <p className="mt-1 text-[10px] text-zinc-500">
        Controls which log files are monitored during execution
      </p>
    </div>
  );
}

function HealthCheckUrls({ workflow, updateWorkflow }: SettingRenderProps) {
  if (workflow.health_check_enabled === false) return null;
  const urls = (workflow.health_check_urls ?? []) as Array<{
    name: string;
    url: string;
  }>;
  return (
    <div>
      <p className="block text-xs font-medium text-zinc-400 mb-1">
        Health Check URLs
      </p>
      {urls.map((hc, i) => (
        <div key={i} className="flex gap-2 mb-1">
          <Input
            className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Name"
            value={hc.name}
            onChange={(e) => {
              const updated = urls.map((item, j) =>
                j === i ? { name: e.target.value, url: item.url } : item
              );
              updateWorkflow({ health_check_urls: updated });
            }}
          />
          <Input
            className="flex-[2] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="URL"
            value={hc.url}
            onChange={(e) => {
              const updated = urls.map((item, j) =>
                j === i ? { name: item.name, url: e.target.value } : item
              );
              updateWorkflow({ health_check_urls: updated });
            }}
          />
          <button
            className="text-red-400 hover:text-red-300 text-sm px-1"
            onClick={() => {
              updateWorkflow({
                health_check_urls: urls.filter((_, j) => j !== i),
              });
            }}
          >
            x
          </button>
        </div>
      ))}
      <button
        className="text-xs text-blue-400 hover:text-blue-300"
        onClick={() => {
          updateWorkflow({
            health_check_urls: [...urls, { name: "", url: "" }],
          });
        }}
      >
        + Add health check URL
      </button>
    </div>
  );
}

function PromptTemplateTrigger({
  workflow,
  onOpenPromptTemplate,
}: {
  workflow: SettingRenderProps["workflow"];
  onOpenPromptTemplate: () => void;
}) {
  return (
    <div>
      <button
        onClick={onOpenPromptTemplate}
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
  );
}

function ResolvedModelPreview({ workflow }: SettingRenderProps) {
  const overrides: ModelOverrides =
    (workflow.model_overrides as ModelOverrides) ?? {};

  const rows = MODEL_OVERRIDE_PHASES.map((phase) => ({
    ...phase,
    resolved: resolveModelForPhase(
      phase.key,
      overrides,
      workflow.model,
      undefined
    ),
  }));

  const badgeClass = (source: string) => {
    switch (source) {
      case "phase":
        return "bg-purple-500/20 text-purple-400";
      case "workflow":
        return "bg-blue-500/20 text-blue-400";
      case "smart":
        return "bg-green-500/20 text-green-400";
      default:
        return "bg-zinc-500/20 text-zinc-400";
    }
  };

  return (
    <div className="rounded-md border border-zinc-700/50 p-3">
      <p className="text-xs font-medium text-zinc-300 mb-2">
        Effective Model Preview
      </p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-[11px]">
            <span className="text-zinc-400 w-24 flex-shrink-0 truncate">
              {row.label}
            </span>
            <span className="text-zinc-200 flex-1 truncate">
              {row.resolved.model}
            </span>
            <span
              className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${badgeClass(row.resolved.source)}`}
            >
              {row.resolved.source}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerPhaseModelSelect({ workflow, updateWorkflow }: SettingRenderProps) {
  const overrides: ModelOverrides =
    (workflow.model_overrides as ModelOverrides) ?? {};
  const hasOverrides = MODEL_OVERRIDE_PHASES.some((phase) => {
    const cfg = overrides[phase.key as keyof ModelOverrides];
    return cfg?.provider || cfg?.model;
  });
  const currentPreset = detectPreset(overrides);

  const updatePhaseOverride = (
    phaseKey: string,
    field: "provider" | "model",
    value: string
  ) => {
    const current = { ...overrides };
    const phaseCfg: ModelOverrideConfig = {
      ...(current[phaseKey as keyof ModelOverrides] ?? {}),
    };
    if (value) {
      phaseCfg[field] = value;
    } else {
      delete phaseCfg[field];
    }
    if (!phaseCfg.provider && !phaseCfg.model) {
      delete current[phaseKey as keyof ModelOverrides];
    } else {
      (current as Record<string, ModelOverrideConfig>)[phaseKey] = phaseCfg;
    }
    updateWorkflow({
      model_overrides: Object.keys(current).length > 0 ? current : undefined,
    });
  };

  const applyPreset = (presetId: string) => {
    if (presetId === "custom") return;
    const preset = MODEL_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      updateWorkflow({
        model_overrides:
          Object.keys(preset.overrides).length > 0
            ? preset.overrides
            : undefined,
      });
    }
  };

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left text-sm text-zinc-400 hover:text-zinc-300 transition-colors py-1">
        <ChevronRight className="w-3.5 h-3.5 [[data-state=open]>&]:rotate-90 transition-transform" />
        Per-Phase Model Selection
        {hasOverrides && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-400 rounded">
            {currentPreset !== "custom"
              ? (MODEL_PRESETS.find((p) => p.id === currentPreset)?.name ??
                "Active")
              : "Custom"}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={currentPreset}
              onChange={(e) => applyPreset(e.target.value)}
              className="flex-1 h-7 px-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              <option value="custom">Custom</option>
              {MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} — {preset.description}
                </option>
              ))}
            </select>
            {(() => {
              try {
                const stored = localStorage.getItem(
                  "last-generation-model-overrides"
                );
                return stored && Object.keys(JSON.parse(stored)).length > 0;
              } catch {
                return false;
              }
            })() && (
              <button
                type="button"
                onClick={() => {
                  try {
                    const stored = localStorage.getItem(
                      "last-generation-model-overrides"
                    );
                    if (stored) {
                      const parsed = JSON.parse(stored);
                      if (parsed && typeof parsed === "object") {
                        updateWorkflow({ model_overrides: parsed });
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }}
                className="h-7 px-2 text-[11px] text-zinc-400 hover:text-blue-400 border border-zinc-700 rounded hover:border-blue-500/30 transition-colors"
                title="Copy model overrides from the last AI generation run"
              >
                From Generation
              </button>
            )}
            {hasOverrides && (
              <button
                type="button"
                onClick={() => updateWorkflow({ model_overrides: undefined })}
                className="h-7 px-2 text-[11px] text-zinc-400 hover:text-red-400 border border-zinc-700 rounded hover:border-red-500/30 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          <p className="text-[10px] text-zinc-500">
            Override provider/model per phase. Empty = inherit from
            workflow-level.
          </p>
          {MODEL_OVERRIDE_PHASES.map((phase) => {
            const cfg = overrides[phase.key as keyof ModelOverrides];
            const provider = cfg?.provider ?? "";
            const model = cfg?.model ?? "";
            return (
              <div key={phase.key} className="flex items-center gap-2">
                <span
                  className="text-[11px] text-zinc-400 w-24 flex-shrink-0 truncate"
                  title={phase.label}
                >
                  {phase.label}
                </span>
                <select
                  className="flex-1 h-7 px-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  value={provider}
                  onChange={(e) => {
                    updatePhaseOverride(phase.key, "provider", e.target.value);
                    if (e.target.value !== provider) {
                      updatePhaseOverride(phase.key, "model", "");
                    }
                  }}
                >
                  <option value="">Inherit</option>
                  {PROVIDER_OPTIONS.filter((p) => p.value !== "").map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {provider && MODELS_BY_PROVIDER[provider] ? (
                  <select
                    className="flex-1 h-7 px-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    value={model}
                    onChange={(e) =>
                      updatePhaseOverride(phase.key, "model", e.target.value)
                    }
                  >
                    {MODELS_BY_PROVIDER[provider]!.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CustomSettingItem({
  def,
  workflow,
  updateWorkflow,
  selectClass,
  onOpenPromptTemplate,
}: SettingRenderProps & {
  def: CustomSettingDef;
  onOpenPromptTemplate: () => void;
}) {
  const props = { workflow, updateWorkflow, selectClass };
  switch (def.customType) {
    case "name_input":
      return <NameInput key={def.key} {...props} />;
    case "description_input":
      return <DescriptionInput key={def.key} {...props} />;
    case "category_input":
      return <CategoryInput key={def.key} {...props} />;
    case "tags_input":
      return <TagsInput key={def.key} {...props} />;
    case "model_select":
      return <ModelSelect key={def.key} {...props} />;
    case "log_source_select":
      return <LogSourceSelect key={def.key} {...props} />;
    case "health_check_urls":
      return <HealthCheckUrls key={def.key} {...props} />;
    case "prompt_template":
      return (
        <PromptTemplateTrigger
          key={def.key}
          workflow={workflow}
          onOpenPromptTemplate={onOpenPromptTemplate}
        />
      );
    case "context_management":
      return null;
    case "per_phase_model_select":
      return <PerPhaseModelSelect key={def.key} {...props} />;
    case "resolved_model_preview":
      return <ResolvedModelPreview key={def.key} {...props} />;
    default:
      return null;
  }
}
