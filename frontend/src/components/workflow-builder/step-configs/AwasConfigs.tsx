"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { UnifiedStep } from "@/types/unified-workflow";

interface AwasConfigsProps {
  step: UnifiedStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function AwasConfigs({ step, onUpdate }: AwasConfigsProps) {
  switch (step.type) {
    case "awas_discover":
    case "awas_check_support":
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              URL
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="https://example.com"
              value={step.url}
              onChange={(e) => onUpdate({ url: e.target.value })}
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
                onUpdate({
                  timeout_seconds: parseInt(e.target.value) || undefined,
                })
              }
            />
          </div>
        </div>
      );

    case "awas_execute":
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              URL
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="https://example.com"
              value={step.url}
              onChange={(e) => onUpdate({ url: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Action ID
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="Action ID from manifest"
              value={step.action_id}
              onChange={(e) => onUpdate({ action_id: e.target.value })}
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
                onUpdate({
                  timeout_seconds: parseInt(e.target.value) || undefined,
                })
              }
            />
          </div>
        </div>
      );

    case "awas_list_actions":
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              URL (optional)
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="Uses last discovered manifest if empty"
              value={step.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value || undefined })}
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
                onUpdate({
                  timeout_seconds: parseInt(e.target.value) || undefined,
                })
              }
            />
          </div>
        </div>
      );

    case "awas_extract_elements":
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              HTML Content
            </label>
            <Textarea
              className="min-h-[80px] font-mono bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="<html>..."
              value={step.html}
              onChange={(e) => onUpdate({ html: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Base URL
            </label>
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
              placeholder="For resolving relative URLs"
              value={step.base_url ?? ""}
              onChange={(e) =>
                onUpdate({ base_url: e.target.value || undefined })
              }
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}
