"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  Route,
  Activity,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Target,
  TrendingDown,
  Shield,
  Zap,
} from "lucide-react";
import { UnifiedStepCard } from "@/components/shared/UnifiedStepCard";
import { mockStepToUnifiedStep } from "@/lib/tree-event-adapter";
import type {
  IntegrationTestResponse,
  IntegrationTestRun,
  ExecutionStep,
  StochasticityWarning,
  CoverageGap,
  ReliabilityInsight,
} from "@/types/integration-testing";
import type { UnifiedExecutionStep } from "@/types/tree-events";

interface IntegrationTestResultsProps {
  /** The integration test run data */
  run: IntegrationTestResponse | IntegrationTestRun;
  /** Optional callback when a step is clicked */
  onStepClick?: (step: UnifiedExecutionStep, index: number) => void;
  /** Whether to show the visual playback toggle */
  showPlaybackToggle?: boolean;
  /** Callback when visual mode is toggled */
  onToggleVisualMode?: () => void;
  /** Map of state/element IDs to display names */
  nameMap?: Map<string, string>;
}

/**
 * Helper to resolve an ID to a display name
 */
function resolveName(id: string, nameMap?: Map<string, string>): string {
  return nameMap?.get(id) ?? id;
}

/**
 * IntegrationTestResults - Non-Visual Mode Display
 *
 * Displays step-by-step execution behavior with detailed insights including:
 * - Summary header with coverage statistics
 * - Step-by-step execution log
 * - Insights panel with reliability, stochasticity, and coverage gaps
 */
export function IntegrationTestResults({
  run,
  onStepClick,
  showPlaybackToggle = true,
  onToggleVisualMode,
  nameMap,
}: IntegrationTestResultsProps) {
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<"steps" | "insights">("steps");

  // Normalize run data with defaults (handles both camelCase and snake_case from API)
  const normalizedRun = {
    ...run,
    steps: run.steps ?? [],
    initial_states: run.initial_states ?? [],
    final_states: run.final_states ?? [],
    reliability_insights: run.reliability_insights ?? [],
    stochasticity_warnings: run.stochasticity_warnings ?? [],
    coverage_gaps: run.coverage_gaps ?? [],
    coverage_data: run.coverage_data ?? {
      states_covered: 0,
      total_states: 0,
      transitions_covered: 0,
      total_transitions: 0,
      coverage_percentage: 0,
    },
  };

  // Convert mock steps to unified format for display
  const unifiedSteps = normalizedRun.steps.map(mockStepToUnifiedStep);

  const handleStepToggle = (index: number) => {
    setExpandedStepIndex(expandedStepIndex === index ? null : index);
    if (onStepClick && unifiedSteps[index]) {
      onStepClick(unifiedSteps[index], index);
    }
  };

  const getStatusBadge = () => {
    switch (run.status) {
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Activity className="w-3 h-3 mr-1 animate-pulse" />
            Running
          </Badge>
        );
      case "timeout":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Timeout
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
            <Info className="w-3 h-3 mr-1" />
            {run.status}
          </Badge>
        );
    }
  };

  const formatDuration = (ms: number) => {
    if (ms === 0) return "0ms (virtual)";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
  };

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <SummaryHeader
        run={normalizedRun}
        getStatusBadge={getStatusBadge}
        formatDuration={formatDuration}
        showPlaybackToggle={showPlaybackToggle}
        onToggleVisualMode={onToggleVisualMode}
        nameMap={nameMap}
      />

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "steps" | "insights")}
      >
        <TabsList className="bg-[#1A1A1B]/50 border border-gray-800/50">
          <TabsTrigger
            value="steps"
            className="data-[state=active]:bg-[#00D9FF]/20 data-[state=active]:text-[#00D9FF]"
          >
            <Route className="w-4 h-4 mr-2" />
            Execution Steps ({unifiedSteps.length})
          </TabsTrigger>
          <TabsTrigger
            value="insights"
            className="data-[state=active]:bg-[#00D9FF]/20 data-[state=active]:text-[#00D9FF]"
          >
            <Shield className="w-4 h-4 mr-2" />
            Insights
            {(normalizedRun.reliability_insights.length > 0 ||
              normalizedRun.stochasticity_warnings.length > 0 ||
              normalizedRun.coverage_gaps.length > 0) && (
              <Badge className="ml-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                {normalizedRun.reliability_insights.length +
                  normalizedRun.stochasticity_warnings.length +
                  normalizedRun.coverage_gaps.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="mt-4">
          <ExecutionStepsPanel
            steps={unifiedSteps}
            expandedStepIndex={expandedStepIndex}
            onStepToggle={handleStepToggle}
            nameMap={nameMap}
          />
        </TabsContent>

        <TabsContent value="insights" className="mt-4">
          <InsightsPanel
            reliabilityInsights={normalizedRun.reliability_insights}
            stochasticityWarnings={normalizedRun.stochasticity_warnings}
            coverageGaps={normalizedRun.coverage_gaps}
            nameMap={nameMap}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// Summary Header Component
// =============================================================================

interface SummaryHeaderProps {
  run: IntegrationTestResponse | IntegrationTestRun;
  getStatusBadge: () => React.ReactNode;
  formatDuration: (ms: number) => string;
  showPlaybackToggle?: boolean;
  onToggleVisualMode?: () => void;
  nameMap?: Map<string, string>;
}

function SummaryHeader({
  run,
  getStatusBadge,
  formatDuration,
  showPlaybackToggle,
  onToggleVisualMode,
  nameMap,
}: SummaryHeaderProps) {
  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-xl text-white">
              {run.workflow_name}
            </CardTitle>
            {getStatusBadge()}
          </div>
          {showPlaybackToggle && onToggleVisualMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleVisualMode}
              className="border-[#00D9FF]/30 text-[#00D9FF] hover:bg-[#00D9FF]/10"
            >
              <Activity className="w-4 h-4 mr-2" />
              Visual Playback
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Statistics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatBadge
            icon={<Layers className="w-4 h-4" />}
            label="States"
            value={`${run.coverage_data.states_covered}/${run.coverage_data.total_states}`}
            color="blue"
          />
          <StatBadge
            icon={<Route className="w-4 h-4" />}
            label="Transitions"
            value={`${run.coverage_data.transitions_covered}/${run.coverage_data.total_transitions}`}
            color="purple"
          />
          <StatBadge
            icon={<Activity className="w-4 h-4" />}
            label="Actions"
            value={
              "summary" in run
                ? `${run.summary.successful_actions}/${run.summary.total_actions}`
                : String(run.steps.filter((s: ExecutionStep) => s.type === "action").length)
            }
            color="green"
          />
          <StatBadge
            icon={<Target className="w-4 h-4" />}
            label="Coverage"
            value={`${run.coverage_data.coverage_percentage.toFixed(0)}%`}
            color={
              run.coverage_data.coverage_percentage >= 80
                ? "green"
                : run.coverage_data.coverage_percentage >= 50
                  ? "yellow"
                  : "red"
            }
          />
          <StatBadge
            icon={<Clock className="w-4 h-4" />}
            label="Duration"
            value={formatDuration(run.duration_ms)}
            color="gray"
          />
          <StatBadge
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Warnings"
            value={String(run.stochasticity_warnings.length)}
            color={run.stochasticity_warnings.length > 0 ? "yellow" : "gray"}
          />
        </div>

        {/* Initial and Final States */}
        <div className="mt-4 pt-4 border-t border-gray-800/50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-gray-400 mb-2">Initial States</div>
              <div className="flex flex-wrap gap-1">
                {run.initial_states.length > 0 ? (
                  run.initial_states.map((state: string) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className="text-xs border-blue-500/30 text-blue-400"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-gray-500">None</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-2">Final States</div>
              <div className="flex flex-wrap gap-1">
                {run.final_states.length > 0 ? (
                  run.final_states.map((state: string) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className="text-xs border-green-500/30 text-green-400"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-gray-500">None</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Stat Badge Component
// =============================================================================

interface StatBadgeProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "blue" | "purple" | "green" | "yellow" | "red" | "gray";
}

function StatBadge({ icon, label, value, color }: StatBadgeProps) {
  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
    yellow: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    gray: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${colorClasses[color]}`}
    >
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    </div>
  );
}

// =============================================================================
// Execution Steps Panel
// =============================================================================

interface ExecutionStepsPanelProps {
  steps: UnifiedExecutionStep[];
  expandedStepIndex: number | null;
  onStepToggle: (index: number) => void;
  nameMap?: Map<string, string>;
}

function ExecutionStepsPanel({
  steps,
  expandedStepIndex,
  onStepToggle,
  nameMap,
}: ExecutionStepsPanelProps) {
  if (steps.length === 0) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="py-12 text-center">
          <Route className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-lg font-medium text-gray-400 mb-2">
            No Execution Steps
          </h3>
          <p className="text-sm text-gray-500">
            This integration test has no recorded execution steps.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <UnifiedStepCard
          key={`step-${index}`}
          step={step}
          isExpanded={expandedStepIndex === index}
          onToggle={() => onStepToggle(index)}
          isCurrent={false}
          nameMap={nameMap}
        />
      ))}
    </div>
  );
}

// =============================================================================
// Insights Panel
// =============================================================================

interface InsightsPanelProps {
  reliabilityInsights: ReliabilityInsight[];
  stochasticityWarnings: StochasticityWarning[];
  coverageGaps: CoverageGap[];
  nameMap?: Map<string, string>;
}

function InsightsPanel({
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
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-medium text-gray-400 mb-2">
            No Issues Detected
          </h3>
          <p className="text-sm text-gray-500">
            The integration test completed without any reliability concerns or
            coverage gaps.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reliability Insights */}
      {reliabilityInsights.length > 0 && (
        <InsightSection
          title="Reliability Insights"
          icon={<TrendingDown className="w-5 h-5" />}
          count={reliabilityInsights.length}
          color="red"
        >
          <div className="space-y-3">
            {reliabilityInsights.map((insight) => (
              <ReliabilityInsightCard key={insight.id} insight={insight} nameMap={nameMap} />
            ))}
          </div>
        </InsightSection>
      )}

      {/* Stochasticity Warnings */}
      {stochasticityWarnings.length > 0 && (
        <InsightSection
          title="Stochasticity Warnings"
          icon={<Zap className="w-5 h-5" />}
          count={stochasticityWarnings.length}
          color="yellow"
        >
          <div className="space-y-3">
            {stochasticityWarnings.map((warning) => (
              <StochasticityWarningCard key={warning.id} warning={warning} nameMap={nameMap} />
            ))}
          </div>
        </InsightSection>
      )}

      {/* Coverage Gaps */}
      {coverageGaps.length > 0 && (
        <InsightSection
          title="Coverage Gaps"
          icon={<Target className="w-5 h-5" />}
          count={coverageGaps.length}
          color="purple"
        >
          <div className="space-y-3">
            {coverageGaps.map((gap, index) => (
              <CoverageGapCard key={`gap-${index}`} gap={gap} nameMap={nameMap} />
            ))}
          </div>
        </InsightSection>
      )}
    </div>
  );
}

// =============================================================================
// Insight Section Component
// =============================================================================

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
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-800/20 transition-colors">
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

// =============================================================================
// Insight Card Components
// =============================================================================

function ReliabilityInsightCard({ insight, nameMap }: { insight: ReliabilityInsight; nameMap?: Map<string, string> }) {
  const severityColors = {
    critical: "border-l-red-600 bg-red-500/5",
    high: "border-l-red-500 bg-red-500/5",
    medium: "border-l-yellow-500 bg-yellow-500/5",
    low: "border-l-blue-500 bg-blue-500/5",
    info: "border-l-gray-500 bg-gray-500/5",
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
                : "border-gray-500/30 text-gray-400"
          }`}
        >
          {insight.severity}
        </Badge>
      </div>
      <p className="text-sm text-gray-400 mb-3">{insight.description}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {insight.affected_patterns.map((pattern) => (
          <Badge
            key={pattern}
            variant="outline"
            className="text-xs border-gray-700"
          >
            {resolveName(pattern, nameMap)}
          </Badge>
        ))}
      </div>
      {insight.metric_value !== undefined &&
        insight.metric_threshold !== undefined && (
          <div className="text-xs text-gray-500 mb-2">
            Value: {insight.metric_value.toFixed(1)}% (threshold:{" "}
            {insight.metric_threshold}%)
          </div>
        )}
      <div className="bg-gray-800/30 rounded p-2">
        <div className="text-xs text-gray-400 font-medium mb-1">
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
          <div className="text-xs text-gray-500 mt-1">
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
      <p className="text-sm text-gray-400 mb-3">{warning.description}</p>
      {warning.sample_failures.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">Sample Failures</div>
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
      <div className="bg-gray-800/30 rounded p-2">
        <div className="text-xs text-gray-400 font-medium mb-1">
          Recommendation
        </div>
        <div className="text-sm text-white">{warning.recommendation}</div>
      </div>
    </div>
  );
}

function CoverageGapCard({ gap, nameMap }: { gap: CoverageGap; nameMap?: Map<string, string> }) {
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
      <p className="text-sm text-gray-400 mb-3">{gap.description}</p>
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
      <div className="bg-gray-800/30 rounded p-2">
        <div className="text-xs text-gray-400 font-medium mb-1">
          Recommendation
        </div>
        <div className="text-sm text-white">{gap.recommendation}</div>
      </div>
    </div>
  );
}

export default IntegrationTestResults;
