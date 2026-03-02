"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Target,
  TrendingDown,
  Zap,
} from "lucide-react";
import type {
  StochasticityWarning,
  CoverageGap,
  ReliabilityInsight,
} from "@/types/integration-testing";
import { resolveName } from "../utils";

// -----------------------------------------------------------------------------
// Insight Section (collapsible wrapper)
// -----------------------------------------------------------------------------

interface InsightSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  color: "red" | "yellow" | "purple";
  children: React.ReactNode;
}

function InsightSection({
  title,
  icon,
  count,
  color,
  children,
}: InsightSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  const colorClasses = {
    red: "border-red-500/30 text-red-400",
    yellow: "border-yellow-500/30 text-yellow-400",
    purple: "border-purple-500/30 text-purple-400",
  };

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-surface-raised/20 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={colorClasses[color]}>{icon}</div>
                <CardTitle className="text-lg text-white">{title}</CardTitle>
                <Badge
                  variant="outline"
                  className={`text-xs ${colorClasses[color]}`}
                >
                  {count}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                {isOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Insight Card Components
// -----------------------------------------------------------------------------

function ReliabilityInsightCard({
  insight,
  nameMap,
}: {
  insight: ReliabilityInsight;
  nameMap?: Map<string, string>;
}) {
  const severityColors = {
    critical: "border-l-red-600 bg-red-500/5",
    high: "border-l-red-500 bg-red-500/5",
    medium: "border-l-yellow-500 bg-yellow-500/5",
    low: "border-l-blue-500 bg-blue-500/5",
    info: "border-l-border-default bg-surface-raised/5",
  };

  return (
    <div
      className={`border-l-4 rounded-r-lg p-4 ${severityColors[insight.severity]}`}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-white">{insight.title}</h4>
        <Badge
          variant="outline"
          className={`text-xs ${
            insight.severity === "critical" || insight.severity === "high"
              ? "border-red-500/30 text-red-400"
              : insight.severity === "medium"
                ? "border-yellow-500/30 text-yellow-400"
                : "border-border-subtle text-text-muted"
          }`}
        >
          {insight.severity}
        </Badge>
      </div>
      <p className="text-sm text-text-muted mb-3">{insight.description}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {insight.affected_patterns.map((pattern) => (
          <Badge
            key={pattern}
            variant="outline"
            className="text-xs border-border-default"
          >
            {resolveName(pattern, nameMap)}
          </Badge>
        ))}
      </div>
      {insight.metric_value !== undefined &&
        insight.metric_threshold !== undefined && (
          <div className="text-xs text-text-muted mb-2">
            Value: {insight.metric_value.toFixed(1)}% (threshold:{" "}
            {insight.metric_threshold}%)
          </div>
        )}
      <div className="bg-surface-raised/30 rounded p-2">
        <div className="text-xs text-text-muted font-medium mb-1">
          Recommendation
        </div>
        <div className="text-sm text-white">{insight.recommendation}</div>
      </div>
    </div>
  );
}

function StochasticityWarningCard({
  warning,
  nameMap,
}: {
  warning: StochasticityWarning;
  nameMap?: Map<string, string>;
}) {
  const severityColors = {
    high: "border-l-red-500 bg-red-500/5",
    medium: "border-l-yellow-500 bg-yellow-500/5",
    low: "border-l-blue-500 bg-blue-500/5",
  };

  const warningTypeLabels: Record<string, string> = {
    high_failure_rate: "High Failure Rate",
    inconsistent_timing: "Inconsistent Timing",
    flaky_match: "Flaky Match",
    state_dependent_failure: "State-Dependent Failure",
    intermittent_element: "Intermittent Element",
  };

  return (
    <div
      className={`border-l-4 rounded-r-lg p-4 ${severityColors[warning.severity]}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-medium text-white">
            {warning.pattern_name
              ? resolveName(warning.pattern_name, nameMap)
              : warning.action_type || "Unknown Pattern"}
          </h4>
          <div className="text-xs text-text-muted mt-1">
            {warningTypeLabels[warning.warning_type] || warning.warning_type}
          </div>
        </div>
        <Badge
          variant="outline"
          className="text-xs border-yellow-500/30 text-yellow-400"
        >
          {(warning.historical_failure_rate * 100).toFixed(1)}% failure rate
        </Badge>
      </div>
      <p className="text-sm text-text-muted mb-3">{warning.description}</p>
      {warning.sample_failures.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-text-muted mb-1">Sample Failures</div>
          <div className="space-y-1">
            {warning.sample_failures.slice(0, 3).map((failure, index) => (
              <div
                key={index}
                className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1"
              >
                {failure.error_message}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-surface-raised/30 rounded p-2">
        <div className="text-xs text-text-muted font-medium mb-1">
          Recommendation
        </div>
        <div className="text-sm text-white">{warning.recommendation}</div>
      </div>
    </div>
  );
}

function CoverageGapCard({
  gap,
  nameMap,
}: {
  gap: CoverageGap;
  nameMap?: Map<string, string>;
}) {
  const severityColors = {
    high: "border-l-red-500 bg-red-500/5",
    medium: "border-l-yellow-500 bg-yellow-500/5",
    low: "border-l-blue-500 bg-blue-500/5",
  };

  return (
    <div
      className={`border-l-4 rounded-r-lg p-4 ${severityColors[gap.severity]}`}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-white">{gap.gap_type}</h4>
        <Badge
          variant="outline"
          className={`text-xs ${
            gap.severity === "high"
              ? "border-red-500/30 text-red-400"
              : gap.severity === "medium"
                ? "border-yellow-500/30 text-yellow-400"
                : "border-blue-500/30 text-blue-400"
          }`}
        >
          {gap.severity}
        </Badge>
      </div>
      <p className="text-sm text-text-muted mb-3">{gap.description}</p>
      {gap.affected_states.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {gap.affected_states.map((state) => (
            <Badge
              key={state}
              variant="outline"
              className="text-xs border-purple-500/30 text-purple-400"
            >
              {resolveName(state, nameMap)}
            </Badge>
          ))}
        </div>
      )}
      <div className="bg-surface-raised/30 rounded p-2">
        <div className="text-xs text-text-muted font-medium mb-1">
          Recommendation
        </div>
        <div className="text-sm text-white">{gap.recommendation}</div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main InsightsPanel
// -----------------------------------------------------------------------------

interface InsightsPanelProps {
  reliabilityInsights: ReliabilityInsight[];
  stochasticityWarnings: StochasticityWarning[];
  coverageGaps: CoverageGap[];
  nameMap?: Map<string, string>;
}

export function InsightsPanel({
  reliabilityInsights,
  stochasticityWarnings,
  coverageGaps,
  nameMap,
}: InsightsPanelProps) {
  const hasInsights =
    reliabilityInsights.length > 0 ||
    stochasticityWarnings.length > 0 ||
    coverageGaps.length > 0;

  if (!hasInsights) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-medium text-text-muted mb-2">
            No Issues Detected
          </h3>
          <p className="text-sm text-text-muted">
            The integration test completed without any reliability concerns or
            coverage gaps.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {reliabilityInsights.length > 0 && (
        <InsightSection
          title="Reliability Insights"
          icon={<TrendingDown className="w-5 h-5" />}
          count={reliabilityInsights.length}
          color="red"
        >
          <div className="space-y-3">
            {reliabilityInsights.map((insight) => (
              <ReliabilityInsightCard
                key={insight.id}
                insight={insight}
                nameMap={nameMap}
              />
            ))}
          </div>
        </InsightSection>
      )}

      {stochasticityWarnings.length > 0 && (
        <InsightSection
          title="Stochasticity Warnings"
          icon={<Zap className="w-5 h-5" />}
          count={stochasticityWarnings.length}
          color="yellow"
        >
          <div className="space-y-3">
            {stochasticityWarnings.map((warning) => (
              <StochasticityWarningCard
                key={warning.id}
                warning={warning}
                nameMap={nameMap}
              />
            ))}
          </div>
        </InsightSection>
      )}

      {coverageGaps.length > 0 && (
        <InsightSection
          title="Coverage Gaps"
          icon={<Target className="w-5 h-5" />}
          count={coverageGaps.length}
          color="purple"
        >
          <div className="space-y-3">
            {coverageGaps.map((gap, index) => (
              <CoverageGapCard
                key={`gap-${index}`}
                gap={gap}
                nameMap={nameMap}
              />
            ))}
          </div>
        </InsightSection>
      )}
    </div>
  );
}
