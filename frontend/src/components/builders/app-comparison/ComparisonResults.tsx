"use client";

import { useState } from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  Workflow,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { useRouter } from "next/navigation";
import type {
  ComparisonResult,
  ComparisonSpec,
} from "@/lib/runner/types/exploration";

interface ComparisonResultsProps {
  results: ComparisonResult | null;
}

type SeverityFilter = "all" | "critical" | "major" | "minor" | "info";

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
    icon: <XCircle className="size-4" />,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    label: "Critical",
  },
  major: {
    icon: <AlertTriangle className="size-4" />,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    label: "Major",
  },
  minor: {
    icon: <AlertCircle className="size-4" />,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    label: "Minor",
  },
  info: {
    icon: <Info className="size-4" />,
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

function buildWorkflowDescription(results: ComparisonResult): string {
  const actionableSpecs = results.specs.filter(
    (s) => s.severity === "critical" || s.severity === "major",
  );

  const lines = [
    "Create a verification workflow based on an app comparison analysis.",
    "",
    `Summary: ${results.summary}`,
    "",
    `Total differences found: ${results.totalDifferences} (${results.criticalCount} critical, ${results.majorCount} major)`,
    "",
    "Create verification steps for each of these findings:",
    "",
  ];

  for (const spec of actionableSpecs) {
    lines.push(
      `- [${spec.severity.toUpperCase()}] ${TYPE_LABELS[spec.type]}: ${spec.description}${spec.suggestion ? ` (Suggestion: ${spec.suggestion})` : ""}`,
    );
  }

  lines.push(
    "",
    "Each verification step should use UI Bridge assertions to confirm the issue is resolved.",
    "Include a setup step to navigate to the correct page and a completion step summarizing results.",
  );

  return lines.join("\n");
}

export function ComparisonResults({ results }: ComparisonResultsProps) {
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const router = useRouter();

  if (!results) {
    return (
      <div className="text-center py-12 text-text-muted">
        <p className="text-sm">No results yet. Complete the previous steps.</p>
      </div>
    );
  }

  const actionableCount = results.criticalCount + results.majorCount;

  const handleGenerateWorkflow = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const description = buildWorkflowDescription(results);
      const res = await runnerApi.generateWorkflowAsync({
        description,
        category: "app-comparison",
        tags: ["auto-generated", "comparison"],
      });
      if (res.task_run_id) {
        router.push(`/runs?id=${res.task_run_id}`);
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const filteredSpecs =
    filter === "all"
      ? results.specs
      : results.specs.filter((s) => s.severity === filter);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* AI Summary */}
      <div className="rounded-lg border border-border-subtle bg-surface-raised/30 p-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">
          AI Summary
        </h3>
        <p className="text-sm text-text-secondary leading-relaxed">
          {results.summary}
        </p>
        <div className="flex gap-3 mt-3 text-xs text-text-muted">
          <span>
            Total:{" "}
            <span className="text-text-primary font-medium">
              {results.totalDifferences}
            </span>
          </span>
        </div>
      </div>

      {/* Severity Filter Pills */}
      <div className="flex gap-2 flex-wrap">
        <FilterPill
          label="All"
          count={results.totalDifferences}
          active={filter === "all"}
          onClick={() => setFilter("all")}
          color="text-text-primary"
        />
        <FilterPill
          label="Critical"
          count={results.criticalCount}
          active={filter === "critical"}
          onClick={() => setFilter("critical")}
          color="text-red-400"
        />
        <FilterPill
          label="Major"
          count={results.majorCount}
          active={filter === "major"}
          onClick={() => setFilter("major")}
          color="text-orange-400"
        />
        <FilterPill
          label="Minor"
          count={results.minorCount}
          active={filter === "minor"}
          onClick={() => setFilter("minor")}
          color="text-yellow-400"
        />
        <FilterPill
          label="Info"
          count={results.infoCount}
          active={filter === "info"}
          onClick={() => setFilter("info")}
          color="text-blue-400"
        />
      </div>

      {/* Specs List */}
      <div className="space-y-2">
        {filteredSpecs.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-4">
            No differences match the current filter.
          </p>
        ) : (
          filteredSpecs.map((spec) => <SpecCard key={spec.id} spec={spec} />)
        )}
      </div>

      {/* Generate Workflow */}
      {actionableCount > 0 && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4 text-center space-y-2">
          <p className="text-sm text-text-secondary">
            {actionableCount} actionable finding
            {actionableCount !== 1 ? "s" : ""} (critical + major) can be turned
            into a verification workflow.
          </p>
          <Button
            onClick={handleGenerateWorkflow}
            disabled={generating}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            {generating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Generating Workflow...
              </>
            ) : (
              <>
                <Workflow className="size-4 mr-2" />
                Generate Workflow from Specs
              </>
            )}
          </Button>
          {genError && <p className="text-xs text-red-400">{genError}</p>}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function FilterPill({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-surface-raised border border-border-default " + color
          : "bg-surface-raised/50 border border-transparent text-text-muted hover:text-text-secondary"
      }`}
    >
      {label}
      <span className={`text-[10px] ${active ? color : "text-text-muted"}`}>
        {count}
      </span>
    </button>
  );
}

function SpecCard({ spec }: { spec: ComparisonSpec }) {
  const severity = SEVERITY_CONFIG[spec.severity];

  return (
    <div
      className={`rounded-lg border ${severity.borderColor} ${severity.bgColor} p-3 space-y-2`}
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${severity.color}`}>{severity.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 ${severity.bgColor} ${severity.color} ${severity.borderColor}`}
            >
              {severity.label}
            </Badge>
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 bg-surface-raised/50 text-text-muted"
            >
              {TYPE_LABELS[spec.type] || spec.type}
            </Badge>
            <span className="text-[10px] text-text-muted ml-auto">
              {Math.round(spec.confidence * 100)}% confidence
            </span>
          </div>
          <p className="text-sm text-text-secondary mt-1">{spec.description}</p>
        </div>
      </div>

      {spec.suggestion && (
        <div className="ml-6 p-2 rounded bg-surface-canvas/50 border border-border-subtle">
          <span className="text-[10px] text-text-muted">Suggestion: </span>
          <span className="text-xs text-text-secondary">{spec.suggestion}</span>
        </div>
      )}
    </div>
  );
}
