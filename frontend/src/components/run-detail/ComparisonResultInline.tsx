"use client";

import { useState } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  ChevronDown,
  ChevronRight,
  GitCompare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  ComparisonResult,
  ComparisonSpec,
} from "@/lib/runner/types/exploration";

const SEVERITY_CONFIG: Record<
  ComparisonSpec["severity"],
  {
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
  }
> = {
  critical: {
    icon: <XCircle className="size-3.5" />,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    label: "Critical",
  },
  major: {
    icon: <AlertTriangle className="size-3.5" />,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    label: "Major",
  },
  minor: {
    icon: <AlertCircle className="size-3.5" />,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    label: "Minor",
  },
  info: {
    icon: <Info className="size-3.5" />,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    label: "Info",
  },
};

const TYPE_LABELS: Record<ComparisonSpec["type"], string> = {
  missing_element: "Missing Element",
  extra_element: "Extra Element",
  different_text: "Different Text",
  different_structure: "Different Structure",
  layout_mismatch: "Layout Mismatch",
};

interface ComparisonResultInlineProps {
  result: ComparisonResult;
}

export function ComparisonResultInline({
  result,
}: ComparisonResultInlineProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-pink-500/30 bg-pink-500/5 overflow-hidden">
      {/* Summary Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-surface-raised/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <GitCompare className="size-4 text-pink-400" />
          <span className="text-sm font-medium text-text-primary">
            Comparison Results
          </span>
          <span className="text-xs text-text-muted">
            {result.totalDifferences} difference
            {result.totalDifferences !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Severity count pills */}
          {result.criticalCount > 0 && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
              {result.criticalCount} critical
            </Badge>
          )}
          {result.majorCount > 0 && (
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px] px-1.5 py-0">
              {result.majorCount} major
            </Badge>
          )}
          {result.minorCount > 0 && (
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px] px-1.5 py-0">
              {result.minorCount} minor
            </Badge>
          )}
          {result.infoCount > 0 && (
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">
              {result.infoCount} info
            </Badge>
          )}
          {expanded ? (
            <ChevronDown className="size-4 text-text-muted" />
          ) : (
            <ChevronRight className="size-4 text-text-muted" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-pink-500/20 px-3 py-2 space-y-2">
          {/* Summary text */}
          {result.summary && (
            <p className="text-xs text-text-secondary">{result.summary}</p>
          )}

          {/* Specs list */}
          {result.specs.map((spec) => (
            <InlineSpecCard key={spec.id} spec={spec} />
          ))}
        </div>
      )}
    </div>
  );
}

function InlineSpecCard({ spec }: { spec: ComparisonSpec }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const severity = SEVERITY_CONFIG[spec.severity];

  return (
    <div
      className={`rounded border ${severity.borderColor} ${severity.bgColor} px-2.5 py-1.5`}
    >
      <button
        onClick={() => setDetailsOpen(!detailsOpen)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className={`flex-shrink-0 ${severity.color}`}>
          {severity.icon}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          <Badge
            variant="secondary"
            className={`text-[9px] px-1 ${severity.bgColor} ${severity.color} ${severity.borderColor}`}
          >
            {severity.label}
          </Badge>
          <Badge
            variant="secondary"
            className="text-[9px] px-1 bg-surface-raised/50 text-text-muted"
          >
            {TYPE_LABELS[spec.type] || spec.type}
          </Badge>
          <span className="text-xs text-text-secondary truncate">
            {spec.description}
          </span>
        </div>
        <span className="text-[9px] text-text-muted flex-shrink-0">
          {Math.round(spec.confidence * 100)}%
        </span>
        {(spec.suggestion || spec.description.length > 60) &&
          (detailsOpen ? (
            <ChevronDown className="size-3 text-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-text-muted flex-shrink-0" />
          ))}
      </button>
      {detailsOpen && (
        <div className="mt-1.5 ml-5 space-y-1">
          <p className="text-xs text-text-secondary">{spec.description}</p>
          {spec.suggestion && (
            <div className="p-1.5 rounded bg-surface-canvas/50 border border-border-subtle">
              <span className="text-[10px] text-text-muted">Suggestion: </span>
              <span className="text-[11px] text-text-secondary">
                {spec.suggestion}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
