"use client";

import React from "react";
import { Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AdvancedCheckboxOptionsProps {
  autoIncludeContexts: boolean;
  setAutoIncludeContexts: (value: boolean) => void;
  includeUIBridge: boolean;
  setIncludeUIBridge: (value: boolean) => void;
  reflectionMode: boolean;
  setReflectionMode: (value: boolean) => void;
  investigateCodebase: boolean;
  setInvestigateCodebase: (value: boolean) => void;
  includeDesignGuidance: boolean;
  setIncludeDesignGuidance: (value: boolean) => void;
}

export function AdvancedCheckboxOptions({
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
}: AdvancedCheckboxOptionsProps) {
  return (
    <>
      <div className="flex items-end pb-1">
        <label
          htmlFor="agp-auto-contexts"
          className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
        >
          <Checkbox
            id="agp-auto-contexts"
            checked={autoIncludeContexts}
            onCheckedChange={(v) => setAutoIncludeContexts(v === true)}
          />
          Auto-include contexts
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-zinc-500 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs p-3">
                <p className="text-xs text-muted-foreground">
                  Automatically matches and includes relevant knowledge base
                  documents based on keywords in your description.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </label>
      </div>
      <div className="flex items-end pb-1">
        <label
          htmlFor="agp-ui-bridge"
          className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
        >
          <Checkbox
            id="agp-ui-bridge"
            checked={includeUIBridge}
            onCheckedChange={(v) => setIncludeUIBridge(v === true)}
          />
          UI Bridge instructions
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-zinc-500 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs p-3">
                <p className="text-xs text-muted-foreground">
                  Includes UI Bridge SDK integration instructions
                  (AutoRegisterProvider, useUIElement hooks, page spec files) in
                  the builder prompt. Disable for projects that don&apos;t use
                  the UI Bridge SDK.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </label>
      </div>
      <div className="flex items-end pb-1">
        <label
          htmlFor="agp-reflection-mode"
          className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
        >
          <Checkbox
            id="agp-reflection-mode"
            checked={reflectionMode}
            onCheckedChange={(v) => setReflectionMode(v === true)}
          />
          Reflection mode
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-zinc-500 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs p-3">
                <p className="text-xs text-muted-foreground">
                  Investigates root causes before fixing failures. The AI will
                  research related code, use subagents for exploration, and
                  document findings before implementing changes. Uses more
                  tokens but produces better fixes for complex issues.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </label>
      </div>
      <div className="flex items-end pb-1">
        <label
          htmlFor="agp-investigate-codebase"
          className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
        >
          <Checkbox
            id="agp-investigate-codebase"
            checked={investigateCodebase}
            onCheckedChange={(v) => setInvestigateCodebase(v === true)}
          />
          Investigate codebase
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-zinc-500 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs p-3">
                <p className="text-xs text-muted-foreground">
                  Run an AI investigation step before generating the workflow.
                  Analyzes project structure to produce a more targeted
                  workflow. Adds ~30s to generation time.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </label>
      </div>
      <div className="flex items-end pb-1">
        <label
          htmlFor="agp-design-guidance"
          className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
        >
          <Checkbox
            id="agp-design-guidance"
            checked={includeDesignGuidance}
            onCheckedChange={(v) => setIncludeDesignGuidance(v === true)}
          />
          Design guidance
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-zinc-500 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs p-3">
                <p className="text-xs text-muted-foreground">
                  Include frontend design quality guidance (typography, color,
                  motion, spatial composition, anti-AI-slop rules) in generated
                  workflows. Enable for design-focused frontend tasks.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </label>
      </div>
    </>
  );
}
