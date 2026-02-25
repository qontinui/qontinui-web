"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Sparkles, Loader2, ChevronDown, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface QuickTemplate {
  label: string;
  prompt: string;
}

export interface AiGeneratorPanelProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  accentColor?: AccentColor;
  templates?: QuickTemplate[];
  placeholder?: string;
  generating: boolean;
  error?: string | null;
  onGenerate: (prompt: string) => void;
  // Result rendering
  result?: React.ReactNode;
  onAccept?: () => void;
  onRegenerate?: () => void;
  acceptLabel?: string;
  // Extra inputs (rendered between templates and prompt)
  extraInputs?: React.ReactNode;
  // Disclaimer text
  disclaimer?: string;
}

// =============================================================================
// Accent color mapping
// =============================================================================

type AccentColor =
  | "purple"
  | "violet"
  | "indigo"
  | "amber"
  | "pink"
  | "orange"
  | "emerald"
  | "teal";

const accentColorMap: Record<
  AccentColor,
  { bg: string; hover: string; ring: string }
> = {
  purple: {
    bg: "bg-purple-600",
    hover: "hover:bg-purple-700",
    ring: "focus-visible:ring-purple-600/20",
  },
  violet: {
    bg: "bg-violet-600",
    hover: "hover:bg-violet-700",
    ring: "focus-visible:ring-violet-600/20",
  },
  indigo: {
    bg: "bg-indigo-600",
    hover: "hover:bg-indigo-700",
    ring: "focus-visible:ring-indigo-600/20",
  },
  amber: {
    bg: "bg-amber-600",
    hover: "hover:bg-amber-700",
    ring: "focus-visible:ring-amber-600/20",
  },
  pink: {
    bg: "bg-pink-600",
    hover: "hover:bg-pink-700",
    ring: "focus-visible:ring-pink-600/20",
  },
  orange: {
    bg: "bg-orange-600",
    hover: "hover:bg-orange-700",
    ring: "focus-visible:ring-orange-600/20",
  },
  emerald: {
    bg: "bg-emerald-600",
    hover: "hover:bg-emerald-700",
    ring: "focus-visible:ring-emerald-600/20",
  },
  teal: {
    bg: "bg-teal-600",
    hover: "hover:bg-teal-700",
    ring: "focus-visible:ring-teal-600/20",
  },
};

// =============================================================================
// Component
// =============================================================================

export function AiGeneratorPanel({
  title,
  icon: Icon,
  accentColor = "purple",
  templates,
  placeholder = "Describe what you want to generate...",
  generating,
  error,
  onGenerate,
  result,
  onAccept,
  onRegenerate,
  acceptLabel = "Accept",
  extraInputs,
  disclaimer,
}: AiGeneratorPanelProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");

  const colors = accentColorMap[accentColor];
  const hasResult = result != null;

  const handleGenerate = () => {
    if (!prompt.trim() || generating) return;
    onGenerate(prompt.trim());
  };

  const handleRegenerate = () => {
    if (onRegenerate) {
      onRegenerate();
    } else if (prompt.trim()) {
      onGenerate(prompt.trim());
    }
  };

  const handleTemplateClick = (templatePrompt: string) => {
    setPrompt(templatePrompt);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 w-full px-3 py-2 rounded-lg",
            "bg-surface-raised/50 border border-border-subtle",
            "hover:border-text-muted transition-colors",
            "text-left text-sm font-medium text-text-secondary"
          )}
        >
          {Icon ? (
            <Icon className="size-4 text-text-muted" />
          ) : (
            <Sparkles className="size-4 text-text-muted" />
          )}
          <span className="flex-1">{title}</span>
          <ChevronDown
            className={cn(
              "size-4 text-text-muted transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 space-y-3 rounded-lg border border-border-subtle bg-surface-raised/30 p-3">
          {hasResult ? (
            /* ---- Stage 2: Result Preview ---- */
            <div className="space-y-3">
              <div>{result}</div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={generating}
                  className="gap-1.5"
                >
                  {generating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Regenerate
                </Button>
                {onAccept && (
                  <Button
                    size="sm"
                    onClick={onAccept}
                    className={cn(
                      "gap-1.5 text-white ml-auto",
                      colors.bg,
                      colors.hover
                    )}
                  >
                    <Check className="size-3.5" />
                    {acceptLabel}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            /* ---- Stage 1: Input ---- */
            <div className="space-y-3">
              {/* Quick Templates */}
              {templates && templates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {templates.map((template) => (
                    <button
                      key={template.label}
                      type="button"
                      onClick={() => handleTemplateClick(template.prompt)}
                      className={cn(
                        "bg-surface-raised/50 text-text-muted",
                        "border border-border-subtle hover:border-text-muted",
                        "px-2 py-1 rounded text-xs",
                        "transition-colors"
                      )}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Extra Inputs */}
              {extraInputs && <div>{extraInputs}</div>}

              {/* Prompt Textarea */}
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={placeholder}
                className="min-h-[80px] text-sm bg-surface-canvas/50 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />

              {/* Error Display */}
              {error && <p className="text-xs text-red-400">{error}</p>}

              {/* Generate Button */}
              <div className="flex items-center justify-between">
                {disclaimer && (
                  <p className="text-[10px] text-text-muted max-w-[60%]">
                    {disclaimer}
                  </p>
                )}
                <Button
                  size="sm"
                  disabled={generating || !prompt.trim()}
                  onClick={handleGenerate}
                  className={cn(
                    "gap-1.5 text-white ml-auto",
                    colors.bg,
                    colors.hover
                  )}
                >
                  {generating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  Generate
                </Button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
