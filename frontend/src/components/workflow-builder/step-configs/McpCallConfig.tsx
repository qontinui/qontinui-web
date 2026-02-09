"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import type { McpCallStep } from "@/types/unified-workflow";

interface McpCallConfigProps {
  step: McpCallStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function McpCallConfig({ step, onUpdate }: McpCallConfigProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          MCP Server
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Server ID"
          value={step.server_id}
          onChange={(e) => onUpdate({ server_id: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Server Name (display)
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Server name"
          value={step.server_name ?? ""}
          onChange={(e) =>
            onUpdate({ server_name: e.target.value || undefined })
          }
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Tool Name
        </label>
        <Input
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          placeholder="Tool to call"
          value={step.tool_name}
          onChange={(e) => onUpdate({ tool_name: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (seconds)
        </label>
        <Input
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          value={step.timeout_seconds ?? 30}
          onChange={(e) =>
            onUpdate({ timeout_seconds: parseInt(e.target.value) || undefined })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          className="rounded"
          checked={step.fail_on_error !== false}
          onChange={(e) => onUpdate({ fail_on_error: e.target.checked })}
        />
        Fail on error
      </label>
    </div>
  );
}
