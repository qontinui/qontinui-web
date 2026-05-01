"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SelectionPhaseProps,
  TestType,
} from "../_types/orchestrator-types";

function StepHeader({
  number,
  title,
  subtitle,
  optional,
}: {
  number: number;
  title: string;
  subtitle?: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 rounded-full bg-purple-600 text-white text-xs font-medium flex items-center justify-center shrink-0">
        {number}
      </span>
      <span className="text-sm font-medium text-text-primary">{title}</span>
      {subtitle && (
        <span className="text-xs text-text-muted">
          {optional ? `(${subtitle})` : subtitle}
        </span>
      )}
    </div>
  );
}

function HttpMethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  const colors: Record<string, string> = {
    GET: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    POST: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    PUT: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    PATCH: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    DELETE: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono px-1.5 py-0",
        colors[m] || "text-text-muted"
      )}
    >
      {m}
    </Badge>
  );
}

export function SelectionPhase({
  requests,
  selectedIds,
  searchQuery,
  onSearchChange,
  onToggle,
  onSelectAll,
  onClear,
  loadingRequests,
  totalAvailable,
  testDescription,
  onDescriptionChange,
  additionalContext,
  onContextChange,
  testType,
  onTestTypeChange,
}: SelectionPhaseProps) {
  return (
    <div className="p-4 space-y-5">
      {/* Step 1: Select API Requests */}
      <div className="space-y-3">
        <StepHeader
          number={1}
          title="Select API Requests"
          subtitle={`${selectedIds.size} of ${totalAvailable} selected`}
        />

        {/* Search bar + actions */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search requests..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-canvas/50 border border-border-subtle/50 rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onSelectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>

        {/* Request list */}
        <div className="max-h-56 overflow-auto border border-border-subtle/50 rounded-md bg-surface-canvas/30">
          {loadingRequests ? (
            <div className="flex items-center justify-center p-8 text-text-muted">
              <Loader2 className="size-5 animate-spin mr-2" />
              Loading saved requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="p-6 text-center text-sm text-text-muted">
              {totalAvailable === 0
                ? "No saved API requests found. Create some in the API Request Library first."
                : "No requests match your search."}
            </div>
          ) : (
            requests.map((req) => (
              <div
                key={req.id}
                role="option"
                tabIndex={0}
                aria-selected={selectedIds.has(req.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 border-b border-border-subtle/20 last:border-b-0 cursor-pointer",
                  "hover:bg-surface-raised/40 transition-colors",
                  selectedIds.has(req.id) && "bg-purple-500/5"
                )}
                onClick={() => onToggle(req.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggle(req.id);
                  }
                }}
              >
                <Checkbox
                  checked={selectedIds.has(req.id)}
                  onCheckedChange={() => onToggle(req.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <HttpMethodBadge method={req.method} />
                    <span className="text-sm text-text-primary truncate">
                      {req.name}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted truncate mt-0.5">
                    {req.url}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Step 2: Describe Test */}
      <div className="space-y-3">
        <StepHeader
          number={2}
          title="Describe Your Test"
          subtitle="What should the test verify?"
        />
        <Textarea
          value={testDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="e.g., Verify that creating a user returns a valid ID, then fetching that user returns the correct data"
          className="min-h-[80px] text-sm bg-surface-canvas/50 resize-none"
        />
      </div>

      {/* Step 3: Additional Context */}
      <div className="space-y-3">
        <StepHeader
          number={3}
          title="Additional Context"
          subtitle="Optional"
          optional
        />
        <Textarea
          value={additionalContext}
          onChange={(e) => onContextChange(e.target.value)}
          placeholder="Any additional constraints or context for the AI..."
          className="min-h-[60px] text-sm bg-surface-canvas/50 resize-none"
        />
      </div>

      {/* Test type */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-secondary">Test Type:</span>
        <Select
          value={testType}
          onValueChange={(v) => onTestTypeChange(v as TestType)}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="python_script">Python Script</SelectItem>
            <SelectItem value="playwright_cdp">Playwright CDP</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
