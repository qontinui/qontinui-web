"use client";

import { useReliabilityStats } from "@/hooks/useTesting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, TrendingUp, TrendingDown } from "lucide-react";

interface ReliabilityStatsProps {
  projectId: string;
  workflowId?: string;
}

export function ReliabilityStats({
  projectId,
  workflowId,
}: ReliabilityStatsProps) {
  const {
    data: stats,
    isLoading,
    error,
  } = useReliabilityStats(projectId, workflowId);

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading reliability stats...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">
            Error loading stats: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Reliability Statistics</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">No reliability data available</div>
        </CardContent>
      </Card>
    );
  }

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return "text-green-500";
    if (rate >= 70) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Overall Reliability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-sm text-gray-400 mb-2">Success Rate</div>
              <div
                className={`text-3xl font-bold ${getSuccessRateColor(stats.overall_success_rate)}`}
              >
                {stats.overall_success_rate.toFixed(1)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-400 mb-2">
                Total Transitions
              </div>
              <div className="text-3xl font-bold text-[#00D9FF]">
                {stats.total_transitions_tested}
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-400 mb-2">Successful</div>
              <div className="text-3xl font-bold text-green-500">
                {stats.successful_transitions}
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-400 mb-2">Failed</div>
              <div className="text-3xl font-bold text-red-500">
                {stats.failed_transitions}
              </div>
            </div>
          </div>
          <div className="mt-6 p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">
              Average Transition Time
            </div>
            <div className="text-2xl font-bold text-[#BD00FF]">
              {stats.average_transition_time_ms.toFixed(0)}ms
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Most Reliable Transitions */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            <CardTitle>Most Reliable Transitions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {stats.most_reliable_transitions.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              No data available
            </div>
          ) : (
            <div className="space-y-3">
              {stats.most_reliable_transitions.map((transition, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-[#0A0A0B]/50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {transition.from_state}
                      </span>
                      <span className="text-gray-500">→</span>
                      <span className="font-medium">{transition.to_state}</span>
                      <Badge variant="outline" className="ml-2 text-xs">
                        {transition.action_type}
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-400">
                      {transition.total_attempts} attempts •{" "}
                      {transition.average_duration_ms.toFixed(0)}ms avg
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-lg font-bold text-green-500">
                      {transition.success_rate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Least Reliable Transitions */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-500" />
            <CardTitle>Least Reliable Transitions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {stats.least_reliable_transitions.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              No data available
            </div>
          ) : (
            <div className="space-y-3">
              {stats.least_reliable_transitions.map((transition, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-[#0A0A0B]/50 rounded-lg border border-red-500/20"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {transition.from_state}
                      </span>
                      <span className="text-gray-500">→</span>
                      <span className="font-medium">{transition.to_state}</span>
                      <Badge variant="outline" className="ml-2 text-xs">
                        {transition.action_type}
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-400">
                      {transition.total_attempts} attempts •{" "}
                      {transition.average_duration_ms.toFixed(0)}ms avg
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-lg font-bold text-red-500">
                      {transition.success_rate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* State Reliability */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>State Reliability</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.state_reliability.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              No data available
            </div>
          ) : (
            <div className="space-y-3">
              {stats.state_reliability.slice(0, 10).map((state, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-[#0A0A0B]/50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="font-medium mb-1">{state.state_name}</div>
                    <div className="text-sm text-gray-400">
                      {state.visit_count} visits •{" "}
                      {state.average_duration_ms.toFixed(0)}ms avg
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          state.success_rate >= 90
                            ? "bg-green-500"
                            : state.success_rate >= 70
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }`}
                        style={{ width: `${state.success_rate}%` }}
                      />
                    </div>
                    <span
                      className={`text-sm font-medium ${getSuccessRateColor(state.success_rate)}`}
                    >
                      {state.success_rate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
