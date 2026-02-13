"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CheckStep, CheckType } from "@/types/unified-workflow";

const CHECK_TYPE_OPTIONS: { value: CheckType; label: string }[] = [
  { value: "lint", label: "Lint" },
  { value: "format", label: "Format" },
  { value: "typecheck", label: "Type Check" },
  { value: "analyze", label: "Code Analysis" },
  { value: "security", label: "Security" },
  { value: "custom_command", label: "Custom Command" },
  { value: "ai_review", label: "AI Review" },
];

interface CheckConfigProps {
  step: CheckStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function CheckConfig({ step, onUpdate }: CheckConfigProps) {
  const isAiReview = step.check_type === "ai_review";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Check Type
        </label>
        <Select
          value={step.check_type}
          onValueChange={(v) => onUpdate({ check_type: v })}
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHECK_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isAiReview ? (
        <>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              AI Review Prompt
            </label>
            <Textarea
              className="min-h-[120px] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="Enter the prompt for AI review..."
              value={step.ai_review_prompt ?? ""}
              onChange={(e) =>
                onUpdate({ ai_review_prompt: e.target.value || undefined })
              }
            />
            <p className="text-xs text-zinc-500 mt-1">
              Instructions for the AI to evaluate the input content.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Input Path
            </label>
            <Input
              className="font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="{{artifact_dir}}/output.json"
              value={step.ai_review_input_path ?? ""}
              onChange={(e) =>
                onUpdate({
                  ai_review_input_path: e.target.value || undefined,
                })
              }
            />
            <p className="text-xs text-zinc-500 mt-1">
              Path to the file whose contents will be reviewed by the AI.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                className="rounded"
                checked={step.ai_review_validate_as_workflow ?? false}
                onChange={(e) =>
                  onUpdate({
                    ai_review_validate_as_workflow: e.target.checked,
                  })
                }
              />
              Validate as workflow JSON
            </label>
            <p className="text-xs text-zinc-500 ml-6">
              When enabled, the input is validated as a well-formed workflow
              definition before AI review.
            </p>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Tool
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="e.g., ruff, eslint, mypy"
              value={step.tool ?? ""}
              onChange={(e) => onUpdate({ tool: e.target.value || undefined })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Command
            </label>
            <Input
              className="font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="Override command"
              value={step.command ?? ""}
              onChange={(e) =>
                onUpdate({ command: e.target.value || undefined })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Working Directory
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="Relative to project root"
              value={step.working_directory ?? ""}
              onChange={(e) =>
                onUpdate({ working_directory: e.target.value || undefined })
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                className="rounded"
                checked={step.auto_fix ?? false}
                onChange={(e) => onUpdate({ auto_fix: e.target.checked })}
              />
              Auto-fix (if supported)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                className="rounded"
                checked={step.fail_on_warning ?? false}
                onChange={(e) =>
                  onUpdate({ fail_on_warning: e.target.checked })
                }
              />
              Fail on warnings
            </label>
          </div>
        </>
      )}
    </div>
  );
}
