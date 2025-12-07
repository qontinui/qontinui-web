"use client";

import { useTestRun } from "@/hooks/useTesting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import Image from "next/image";

interface TestRunDetailsProps {
  runId: string;
}

export function TestRunDetails({ runId }: TestRunDetailsProps) {
  const { data: run, isLoading, error } = useTestRun(runId);

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading test run details...</div>
        </CardContent>
      </Card>
    );
  }

  if (error || !run) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">Error loading test run details</div>
        </CardContent>
      </Card>
    );
  }

  const successRate =
    run.total_transitions > 0
      ? ((run.successful_transitions / run.total_transitions) * 100).toFixed(1)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl mb-2">
                {run.workflow_name}
              </CardTitle>
              <div className="text-sm text-gray-400">
                Run ID: {run.id} • Started{" "}
                {format(new Date(run.start_time), "MMM dd, yyyy HH:mm")}
              </div>
            </div>
            <Badge
              className={
                run.status === "completed"
                  ? "bg-green-500/20 text-green-500 border-green-500/30"
                  : run.status === "failed"
                    ? "bg-red-500/20 text-red-500 border-red-500/30"
                    : "bg-blue-500/20 text-blue-500 border-blue-500/30"
              }
            >
              {run.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="space-y-2">
              <div className="text-sm text-gray-400">Duration</div>
              <div className="text-2xl font-bold">
                {run.duration_seconds
                  ? `${Math.floor(run.duration_seconds / 60)}m ${run.duration_seconds % 60}s`
                  : "-"}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-gray-400">Coverage</div>
              <div className="text-2xl font-bold text-[#00D9FF]">
                {run.coverage_percentage.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                {run.states_covered} / {run.total_states} states
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-gray-400">Success Rate</div>
              <div className="text-2xl font-bold text-green-500">
                {successRate}%
              </div>
              <div className="text-xs text-gray-500">
                {run.successful_transitions} / {run.total_transitions}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-gray-400">Deficiencies</div>
              <div className="text-2xl font-bold text-red-400">
                {run.deficiencies_found}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabbed Content */}
      <Tabs defaultValue="transitions" className="w-full">
        <TabsList className="bg-[#1A1A1B]/50 border border-gray-800/50">
          <TabsTrigger value="transitions">Transitions</TabsTrigger>
          <TabsTrigger value="coverage">State Coverage</TabsTrigger>
          <TabsTrigger value="deficiencies">Deficiencies</TabsTrigger>
        </TabsList>

        {/* Transitions Tab */}
        <TabsContent value="transitions">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle>Transition Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {run.transitions.map((transition) => (
                  <div
                    key={transition.id}
                    className="flex items-start gap-4 p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30"
                  >
                    <div className="flex-shrink-0 mt-1">
                      {transition.success ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">
                          {transition.from_state}
                        </span>
                        <span className="text-gray-500">→</span>
                        <span className="font-medium">
                          {transition.to_state}
                        </span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {transition.action_type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        <span>{transition.duration_ms}ms</span>
                        <span>
                          {format(new Date(transition.executed_at), "HH:mm:ss")}
                        </span>
                      </div>
                      {transition.error_message && (
                        <div className="mt-2 text-sm text-red-400 bg-red-500/10 p-2 rounded">
                          {transition.error_message}
                        </div>
                      )}
                    </div>
                    {transition.screenshot_url && (
                      <div className="flex-shrink-0">
                        <Image
                          src={transition.screenshot_url}
                          alt="Transition screenshot"
                          width={100}
                          height={75}
                          className="rounded border border-gray-700 cursor-pointer hover:border-[#00D9FF]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Coverage Tab */}
        <TabsContent value="coverage">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle>State Coverage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {run.state_coverage.map((state) => (
                  <div
                    key={state.state_name}
                    className="flex items-center justify-between p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30"
                  >
                    <div className="flex-1">
                      <div className="font-medium mb-1">{state.state_name}</div>
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        <span>Visited: {state.times_visited}</span>
                        <span>Success: {state.successful_visits}</span>
                        <span>Failed: {state.failed_visits}</span>
                        <span>Avg: {state.average_duration_ms}ms</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500"
                          style={{
                            width: `${state.times_visited > 0 ? (state.successful_visits / state.times_visited) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium">
                        {state.times_visited > 0
                          ? (
                              (state.successful_visits / state.times_visited) *
                              100
                            ).toFixed(0)
                          : 0}
                        %
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deficiencies Tab */}
        <TabsContent value="deficiencies">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle>Deficiencies Found</CardTitle>
            </CardHeader>
            <CardContent>
              {run.deficiencies.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  No deficiencies found in this test run
                </div>
              ) : (
                <div className="space-y-4">
                  {run.deficiencies.map((deficiency) => (
                    <div
                      key={deficiency.id}
                      className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-red-500/30"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-red-400" />
                          <span className="font-medium">
                            {deficiency.title}
                          </span>
                        </div>
                        <Badge
                          className={
                            deficiency.severity === "critical"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : deficiency.severity === "high"
                                ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                : deficiency.severity === "medium"
                                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                                  : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                          }
                        >
                          {deficiency.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-400 mb-2">
                        {deficiency.description}
                      </p>
                      <div className="text-xs text-gray-500">
                        State: {deficiency.state_name}
                        {deficiency.transition_from &&
                          deficiency.transition_to && (
                            <span>
                              {" "}
                              • Transition: {deficiency.transition_from} →{" "}
                              {deficiency.transition_to}
                            </span>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
