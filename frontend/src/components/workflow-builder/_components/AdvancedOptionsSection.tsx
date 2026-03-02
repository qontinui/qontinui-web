"use client";

import React from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GENERATE_PROVIDER_OPTIONS as PROVIDERS,
  MODELS_BY_PROVIDER,
  MODEL_OVERRIDE_PHASES,
  PROVIDER_OPTIONS,
} from "@qontinui/workflow-utils";
import type {
  ModelOverrideConfig,
  ModelOverrides,
} from "@/types/unified-workflow";
import type { AdvancedOptionsState } from "../_hooks/useAdvancedOptions";
import { AdvancedCheckboxOptions } from "./AdvancedCheckboxOptions";

type AdvancedOptionsSectionProps = AdvancedOptionsState;

export function AdvancedOptionsSection({
  showAdvanced,
  setShowAdvanced,
  category,
  setCategory,
  tagsInput,
  setTagsInput,
  maxIterations,
  setMaxIterations,
  provider,
  setProvider,
  model,
  setModel,
  maxFixIterations,
  setMaxFixIterations,
  autoIncludeContexts,
  setAutoIncludeContexts,
  includeUIBridge,
  setIncludeUIBridge,
  reflectionMode,
  setReflectionMode,
  investigateCodebase,
  setInvestigateCodebase,
  includeDesignGuidance,
  setIncludeDesignGuidance,
  discoveryMode,
  setDiscoveryMode,
  modelsForProvider,
  generationModelOverrides,
  setGenerationModelOverrides,
}: AdvancedOptionsSectionProps) {
  const overrides: ModelOverrides = generationModelOverrides ?? {};
  const hasPhaseOverrides = MODEL_OVERRIDE_PHASES.some((phase) => {
    const cfg = overrides[phase.key as keyof ModelOverrides];
    return cfg?.provider || cfg?.model;
  });

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
    setGenerationModelOverrides(
      Object.keys(current).length > 0 ? current : undefined
    );
  };
  return (
    <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
        {showAdvanced ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Advanced Options
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3 pl-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Category</Label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
              placeholder="e.g., testing, deployment"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">
              Tags (comma-separated)
            </Label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
              placeholder="e.g., python, lint"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Max Iterations</Label>
            <Input
              type="number"
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
              placeholder="10"
              value={maxIterations}
              onChange={(e) => setMaxIterations(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">AI Provider</Label>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel(""); // Reset model when provider changes
              }}
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm h-8 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Default (from Settings)</option>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Model</Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm h-8 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Default (from Settings)</option>
              {modelsForProvider.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400 flex items-center gap-1">
              Verification Rounds
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-zinc-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs p-3">
                    <p className="text-xs text-muted-foreground">
                      After generating, the AI reviews the workflow for errors
                      and fixes them. Each round is one review-and-fix pass. Set
                      to 0 to skip verification.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Input
              type="number"
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8"
              placeholder="3"
              value={maxFixIterations}
              onChange={(e) => setMaxFixIterations(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400 flex items-center gap-1">
              Discovery
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-zinc-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs space-y-2 p-3">
                    <p className="font-medium text-xs">
                      Pre-generation system scan
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Gathers context about your system (project structure,
                      running apps, APIs, available tools) so the AI generates
                      steps with real paths and correct configurations.
                    </p>
                    <div className="text-xs space-y-1 pt-1 border-t border-border">
                      <p>
                        <span className="text-zinc-300 font-medium">Auto</span>{" "}
                        — Only runs tools matching keywords in your description
                      </p>
                      <p>
                        <span className="text-zinc-300 font-medium">
                          Enabled
                        </span>{" "}
                        — Runs all available tools (more thorough, slower)
                      </p>
                      <p>
                        <span className="text-zinc-300 font-medium">
                          Disabled
                        </span>{" "}
                        — Skips discovery entirely (fastest)
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <select
              value={discoveryMode}
              onChange={(e) =>
                setDiscoveryMode(
                  e.target.value as "auto" | "enabled" | "disabled"
                )
              }
              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm h-8 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="auto">Auto</option>
              <option value="enabled">Enabled (all tools)</option>
              <option value="disabled">Disabled</option>
            </select>
            <p className="text-[11px] text-zinc-500">
              Scans your system for context before generating.
            </p>
          </div>
          <AdvancedCheckboxOptions
            autoIncludeContexts={autoIncludeContexts}
            setAutoIncludeContexts={setAutoIncludeContexts}
            includeUIBridge={includeUIBridge}
            setIncludeUIBridge={setIncludeUIBridge}
            reflectionMode={reflectionMode}
            setReflectionMode={setReflectionMode}
            investigateCodebase={investigateCodebase}
            setInvestigateCodebase={setInvestigateCodebase}
            includeDesignGuidance={includeDesignGuidance}
            setIncludeDesignGuidance={setIncludeDesignGuidance}
          />
        </div>

        {/* Per-Phase Model Overrides */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            <ChevronRight className="w-3.5 h-3.5 [[data-state=open]>&]:rotate-90 transition-transform" />
            Per-Phase Model Overrides
            {hasPhaseOverrides && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-400 rounded">
                Active
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2 pl-1">
            <p className="text-[10px] text-zinc-500">
              Override provider/model for investigation and generation phases.
              Empty = inherit from the provider/model above.
            </p>
            {MODEL_OVERRIDE_PHASES.filter((p) =>
              ["investigation", "generation"].includes(p.key)
            ).map((phase) => {
              const cfg = overrides[phase.key as keyof ModelOverrides];
              const phaseProvider = cfg?.provider ?? "";
              const phaseModel = cfg?.model ?? "";
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
                    value={phaseProvider}
                    onChange={(e) => {
                      updatePhaseOverride(
                        phase.key,
                        "provider",
                        e.target.value
                      );
                      if (e.target.value !== phaseProvider) {
                        updatePhaseOverride(phase.key, "model", "");
                      }
                    }}
                  >
                    <option value="">Inherit</option>
                    {PROVIDER_OPTIONS.filter((p) => p.value !== "").map(
                      (opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      )
                    )}
                  </select>
                  {phaseProvider && MODELS_BY_PROVIDER[phaseProvider] ? (
                    <select
                      className="flex-1 h-7 px-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-zinc-600"
                      value={phaseModel}
                      onChange={(e) =>
                        updatePhaseOverride(phase.key, "model", e.target.value)
                      }
                    >
                      {MODELS_BY_PROVIDER[phaseProvider]!.map((opt) => (
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
          </CollapsibleContent>
        </Collapsible>
      </CollapsibleContent>
    </Collapsible>
  );
}
