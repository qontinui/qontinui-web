"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiRequestStep, HttpMethod } from "@/types/unified-workflow";

interface ApiRequestConfigProps {
  step: ApiRequestStep;
  onUpdate: (updates: Record<string, unknown>) => void;
}

export function ApiRequestConfig({ step, onUpdate }: ApiRequestConfigProps) {
  const headerCount = step.headers ? Object.keys(step.headers).length : 0;
  const assertionCount = step.assertions?.length ?? 0;
  const extractionCount = step.extractions?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="w-28">
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Method
          </label>
          <Select
            value={step.method}
            onValueChange={(v: HttpMethod) => onUpdate({ method: v })}
          >
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["GET", "POST", "PUT", "PATCH", "DELETE"] as HttpMethod[]).map(
                (m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            URL
          </label>
          <Input
            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="https://api.example.com/endpoint"
            value={step.url}
            onChange={(e) => onUpdate({ url: e.target.value })}
          />
        </div>
      </div>

      <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-md space-y-1">
        <p className="text-xs text-zinc-400">
          {headerCount} header(s), {assertionCount} assertion(s),{" "}
          {extractionCount} extraction(s)
        </p>
        <p className="text-xs text-zinc-500">
          Use the full API Request Editor for headers, body, assertions, and
          variable extractions.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Timeout (ms)
        </label>
        <Input
          type="number"
          className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
          value={step.timeout_ms ?? 30000}
          onChange={(e) =>
            onUpdate({ timeout_ms: parseInt(e.target.value) || undefined })
          }
        />
      </div>
    </div>
  );
}
