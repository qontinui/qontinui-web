"use client";

import { useTestRunComparison } from "@/hooks/useTesting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Clock,
} from "lucide-react";
import { format } from "date-fns";

interface TestRunComparisonProps {
  run1Id: string;
  run2Id: string;
}

export function TestRunComparison({
  run1Id,
  run2Id,
}: TestRunComparisonProps) {
  const { data: comparison, isLoading, error } = useTestRunComparison(run1Id, run2Id);

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading comparison...</div>
        </CardContent>
      </Card>
    );
  }

  if (error || !comparison) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">Error loading comparison</div>
        </CardContent>
      </Card>
    );
  }

  const { run1, run2, comparison: comp } = comparison;

  const getCoverageColor = (change: number) => {
    if (change > 0) return "text-green-500";
    if (change < 0) return "text-red-500";
    return "text-gray-400";
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6">
      {/* Summary Comparison Card */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle className="text-xl">Test Run Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Run 1 */}
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-400 mb-1">Baseline Run</div>
                <div className="font-medium text-lg">{run1.name}</div>
                <div className="text-xs text-gray-500">
                  {format(new Date(run1.started_at), "MMM dd, yyyy HH:mm")}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Coverage</span>
                  <span className="font-medium">
                    {run1.coverage_percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Pass Rate</span>
                  <span className="font-medium text-green-500">
                    {run1.total_transitions > 0
                      ? (
                          (run1.successful_transitions / run1.total_transitions) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Deficiencies</span>
                  <span className="font-medium text-red-400">
                    {run1.deficiencies_found}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Duration</span>
                  <span className="font-medium">
                    {formatDuration(run1.duration_seconds)}
                  </span>
                </div>
              </div>
            </div>

            {/* Comparison Arrow */}
            <div className="flex items-center justify-center">
              <ArrowRight className="w-8 h-8 text-[#00D9FF]" />
            </div>

            {/* Run 2 */}
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-400 mb-1">Comparison Run</div>
                <div className="font-medium text-lg">{run2.name}</div>
                <div className="text-xs text-gray-500">
                  {format(new Date(run2.started_at), "MMM dd, yyyy HH:mm")}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Coverage</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {run2.coverage_percentage.toFixed(1)}%
                    </span>
                    <span
                      className={`text-xs ${getCoverageColor(comp.coverage_diff.percentage_change)}`}
                    >
                      ({comp.coverage_diff.percentage_change > 0 ? "+" : ""}
                      {comp.coverage_diff.percentage_change.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Pass Rate</span>
                  <span className="font-medium text-green-500">
                    {run2.total_transitions > 0
                      ? (
                          (run2.successful_transitions / run2.total_transitions) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Deficiencies</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-red-400">
                      {run2.deficiencies_found}
                    </span>
                    {comp.deficiencies_diff.new_count !== 0 && (
                      <span
                        className={`text-xs ${comp.deficiencies_diff.new_count > 0 ? "text-red-400" : "text-green-500"}`}
                      >
                        ({comp.deficiencies_diff.new_count > 0 ? "+" : ""}
                        {comp.deficiencies_diff.new_count})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-400">Duration</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {formatDuration(run2.duration_seconds)}
                    </span>
                    {comp.execution_time_diff.seconds_change !== 0 && (
                      <span
                        className={`text-xs ${comp.execution_time_diff.seconds_change > 0 ? "text-red-400" : "text-green-500"}`}
                      >
                        ({comp.execution_time_diff.seconds_change > 0 ? "+" : ""}
                        {comp.execution_time_diff.seconds_change}s)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Coverage Differences */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle className="text-xl">Coverage Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Coverage %</span>
                {comp.coverage_diff.percentage_change > 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : comp.coverage_diff.percentage_change < 0 ? (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                ) : (
                  <Clock className="w-4 h-4 text-gray-500" />
                )}
              </div>
              <div className={`text-2xl font-bold ${getCoverageColor(comp.coverage_diff.percentage_change)}`}>
                {comp.coverage_diff.percentage_change > 0 ? "+" : ""}
                {comp.coverage_diff.percentage_change.toFixed(2)}%
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">States</span>
                {comp.coverage_diff.states_gained > 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : comp.coverage_diff.states_gained < 0 ? (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                ) : (
                  <Clock className="w-4 h-4 text-gray-500" />
                )}
              </div>
              <div className={`text-2xl font-bold ${getCoverageColor(comp.coverage_diff.states_gained)}`}>
                {comp.coverage_diff.states_gained > 0 ? "+" : ""}
                {comp.coverage_diff.states_gained}
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Transitions</span>
                {comp.coverage_diff.transitions_gained > 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : comp.coverage_diff.transitions_gained < 0 ? (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                ) : (
                  <Clock className="w-4 h-4 text-gray-500" />
                )}
              </div>
              <div className={`text-2xl font-bold ${getCoverageColor(comp.coverage_diff.transitions_gained)}`}>
                {comp.coverage_diff.transitions_gained > 0 ? "+" : ""}
                {comp.coverage_diff.transitions_gained}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Regressions */}
      {comp.regressions.length > 0 && (
        <Card className="bg-[#1A1A1B]/50 border-red-500/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Regressions
              </CardTitle>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                {comp.regressions.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {comp.regressions.map((transition, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-red-500/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="font-medium">{transition.from_state}</span>
                    <span className="text-gray-500">→</span>
                    <span className="font-medium">{transition.to_state}</span>
                  </div>
                  {transition.run2_error && (
                    <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded mt-2">
                      {transition.run2_error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fixed Issues */}
      {comp.fixed.length > 0 && (
        <Card className="bg-[#1A1A1B]/50 border-green-500/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Fixed Issues
              </CardTitle>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                {comp.fixed.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {comp.fixed.map((transition, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-green-500/20"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="font-medium">{transition.from_state}</span>
                    <span className="text-gray-500">→</span>
                    <span className="font-medium">{transition.to_state}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Failures */}
      {comp.new_failures.length > 0 && (
        <Card className="bg-[#1A1A1B]/50 border-yellow-500/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                New Failures
              </CardTitle>
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                {comp.new_failures.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {comp.new_failures.map((transition, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-yellow-500/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-yellow-500" />
                    <span className="font-medium">{transition.from_state}</span>
                    <span className="text-gray-500">→</span>
                    <span className="font-medium">{transition.to_state}</span>
                    <Badge variant="outline" className="text-xs">
                      New in run 2
                    </Badge>
                  </div>
                  {transition.error && (
                    <div className="text-sm text-yellow-400 bg-yellow-500/10 p-2 rounded mt-2">
                      {transition.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unchanged Stats */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle className="text-xl">Unchanged Transitions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="text-4xl font-bold text-gray-400 mb-2">
              {comp.unchanged_count}
            </div>
            <div className="text-sm text-gray-500">
              Transitions with consistent results across both runs
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
