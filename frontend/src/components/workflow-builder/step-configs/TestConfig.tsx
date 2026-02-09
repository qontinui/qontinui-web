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
import type { TestStep, TestType } from "@/types/unified-workflow";

const TEST_TYPE_OPTIONS: { value: TestType; label: string }[] = [
  { value: "playwright", label: "Playwright" },
  { value: "qontinui_vision", label: "Qontinui Vision" },
  { value: "python", label: "Python" },
  { value: "repository", label: "Repository" },
  { value: "custom_command", label: "Custom Command" },
];

interface TestConfigProps {
  step: TestStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function TestConfig({ step, onUpdate }: TestConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Test Type
        </label>
        <Select
          value={step.test_type}
          onValueChange={(v) => onUpdate({ test_type: v })}
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEST_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(step.test_type === "custom_command" ||
        step.test_type === "repository") && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Command
          </label>
          <Input
            className="font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="e.g., pytest tests/"
            value={step.command ?? ""}
            onChange={(e) => onUpdate({ command: e.target.value || undefined })}
          />
        </div>
      )}

      {step.test_type === "playwright" && (
        <>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Target URL
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="https://localhost:3000"
              value={step.target_url ?? ""}
              onChange={(e) =>
                onUpdate({ target_url: e.target.value || undefined })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Script ID
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="Select from library..."
              value={step.script_id ?? ""}
              onChange={(e) =>
                onUpdate({ script_id: e.target.value || undefined })
              }
            />
          </div>
        </>
      )}

      {(step.test_type === "python" || step.test_type === "playwright") && (
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Inline Code
          </label>
          <Textarea
            className="min-h-[80px] font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="Test code..."
            value={step.code ?? ""}
            onChange={(e) => onUpdate({ code: e.target.value || undefined })}
          />
        </div>
      )}

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

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (seconds)
        </label>
        <Input
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          value={step.timeout_seconds ?? 60}
          onChange={(e) =>
            onUpdate({ timeout_seconds: parseInt(e.target.value) || undefined })
          }
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Description
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="What this test verifies"
          value={step.description ?? ""}
          onChange={(e) =>
            onUpdate({ description: e.target.value || undefined })
          }
        />
      </div>
    </div>
  );
}
