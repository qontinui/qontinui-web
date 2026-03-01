"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Settings,
  FileCode,
  Info,
} from "lucide-react";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { PromptTemplateEditor } from "./PromptTemplateEditor";
import type { LogSourceSelection } from "@/types/unified-workflow";
import {
  type SettingDef,
  type BooleanSettingDef,
  type NumberSettingDef,
  type SelectSettingDef,
  type CustomSettingDef,
  type SettingsSection,
  WORKFLOW_SETTINGS_CONFIG,
  MODELS_BY_PROVIDER,
  getVisibleSections,
  getBooleanDisplayValue,
  toBooleanStoredValue,
  getLogSourceValue,
  parseLogSourceValue,
} from "@qontinui/workflow-utils";

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

  const visibleSections = getVisibleSections(
    WORKFLOW_SETTINGS_CONFIG,
    features
  );

  // ─── Setting Renderers ──────────────────────────────────────────────

  function booleanSetting(def: BooleanSettingDef) {
    const displayValue = getBooleanDisplayValue(
      def,
      (workflow as never)[def.key]
    );
    return (
      <label
        key={def.key}
        className="flex items-center gap-2 text-sm text-zinc-400"
      >
        <input
          type="checkbox"
          className="rounded"
          checked={displayValue}
          onChange={(e) =>
            updateWorkflow({
              [def.key]: toBooleanStoredValue(def, e.target.checked),
            })
          }
        />
        {def.label}
        {def.tooltip && (
          <span className="relative group">
            <Info className="w-3.5 h-3.5 text-zinc-500 cursor-help" />
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 bg-zinc-700 border border-zinc-600 rounded-lg text-[11px] text-zinc-300 leading-relaxed z-50 shadow-lg pointer-events-none">
              {def.tooltip}
            </span>
          </span>
        )}
      </label>
    );
  }

  function numberSetting(def: NumberSettingDef) {
    return (
      <div key={def.key}>
        <label
          htmlFor={`sp-${def.key}`}
          className="block text-xs font-medium text-zinc-400 mb-1"
        >
          {def.label}
        </label>
        <Input
          id={`sp-${def.key}`}
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder={def.placeholder}
          min={def.min}
          max={def.max}
          value={(workflow as never)[def.key] ?? ""}
          onChange={(e) =>
            updateWorkflow({
              [def.key]: e.target.value
                ? parseInt(e.target.value)
                : def.key === "timeout_seconds"
                  ? null
                  : undefined,
            })
          }
        />
        {def.description && (
          <p className="mt-1 text-[10px] text-zinc-500">{def.description}</p>
        )}
      </div>
    );
  }

  function selectSetting(def: SelectSettingDef) {
    return (
      <div key={def.key}>
        <label
          htmlFor={`sp-${def.key}`}
          className="block text-xs font-medium text-zinc-400 mb-1"
        >
          {def.label}
        </label>
        <select
          id={`sp-${def.key}`}
          className={selectClass}
          value={((workflow as never)[def.key] as string) ?? def.defaultValue}
          onChange={(e) =>
            updateWorkflow({
              [def.key]: e.target.value || undefined,
              ...(def.key === "provider" ? { model: undefined } : {}),
            })
          }
        >
          {def.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {def.description && (
          <p className="mt-1 text-[10px] text-zinc-500">{def.description}</p>
        )}
      </div>
    );
  }

  function customSetting(def: CustomSettingDef) {
    switch (def.customType) {
      case "name_input":
        return (
          <div key={def.key}>
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

      case "description_input":
        return (
          <div key={def.key}>
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

      case "category_input":
        return (
          <div key={def.key}>
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

      case "tags_input":
        return (
          <div key={def.key}>
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

      case "model_select": {
        const provider = workflow.provider;
        const models = provider ? MODELS_BY_PROVIDER[provider] : undefined;
        if (!provider) return null;
        return (
          <div key={def.key}>
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

      case "log_source_select":
        return (
          <div key={def.key}>
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

      case "health_check_urls": {
        if (workflow.health_check_enabled === false) return null;
        const urls = (workflow.health_check_urls ?? []) as Array<{
          name: string;
          url: string;
        }>;
        return (
          <div key={def.key}>
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

      case "prompt_template":
        return (
          <div key={def.key}>
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
        );

      case "context_management":
        // Context management is app-specific — keep outside config loop
        return null;

      default:
        return null;
    }
  }

  // ─── Setting Dispatch ───────────────────────────────────────────────

  function settingItem(def: SettingDef) {
    switch (def.type) {
      case "boolean":
        return booleanSetting(def);
      case "number":
        return numberSetting(def);
      case "select":
        return selectSetting(def);
      case "custom":
        return customSetting(def);
    }
  }

  // ─── Layout ─────────────────────────────────────────────────────────

  // Collect boolean settings in the "ai" and "monitoring" sections to
  // group them nicely, while rendering other settings individually.
  function sectionBlock(section: SettingsSection) {
    const booleans = section.settings.filter(
      (s) => s.type === "boolean"
    ) as BooleanSettingDef[];
    const others = section.settings.filter((s) => s.type !== "boolean");

    // Render "identity" and "metadata" sections with special grid layouts
    if (section.id === "identity") {
      return (
        <React.Fragment key={section.id}>
          {section.settings.map(settingItem)}
        </React.Fragment>
      );
    }

    if (section.id === "metadata") {
      return (
        <div key={section.id} className="grid grid-cols-2 gap-3">
          {section.settings.map(settingItem)}
        </div>
      );
    }

    if (section.id === "iteration") {
      return (
        <div key={section.id} className="grid grid-cols-2 gap-3">
          {section.settings.map(settingItem)}
        </div>
      );
    }

    // For ai section: group provider+model in a row, then booleans
    if (section.id === "ai") {
      const providerDef = others.find((s) => s.key === "provider");
      const modelDef = others.find((s) => s.key === "model");
      const otherCustom = others.filter(
        (s) => s.key !== "provider" && s.key !== "model"
      );
      return (
        <React.Fragment key={section.id}>
          {(providerDef || modelDef) && (
            <div className="grid grid-cols-2 gap-3">
              {providerDef && settingItem(providerDef)}
              {modelDef && settingItem(modelDef)}
            </div>
          )}
          {otherCustom.map(settingItem)}
          {booleans.length > 0 && (
            <div className="space-y-2">{booleans.map(booleanSetting)}</div>
          )}
        </React.Fragment>
      );
    }

    // Default: render all settings in order
    return (
      <React.Fragment key={section.id}>
        {others.map(settingItem)}
        {booleans.length > 0 && (
          <div className="space-y-2">{booleans.map(booleanSetting)}</div>
        )}
      </React.Fragment>
    );
  }

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
            {visibleSections.map(sectionBlock)}
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
