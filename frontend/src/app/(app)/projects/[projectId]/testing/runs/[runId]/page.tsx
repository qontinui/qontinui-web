"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  PlayCircle,
  Download,
  ZoomIn,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useTestRun } from "@/hooks/useTesting";
import { RequireProject } from "@/components/require-project";
import { format } from "date-fns";
import Image from "next/image";
import { ApiConfig } from "@/services/api-config";

interface WebSocketMessage {
  type: string;
  data?: {
    status?: string;
    current_step?: number;
    total_steps?: number;
    transition?: {
      from_state: string;
      to_state: string;
      action_type: string;
      success: boolean;
      duration_ms: number;
      error_message?: string;
      screenshot_url?: string;
    };
    coverage_percentage?: number;
    states_covered?: number;
    deficiency?: {
      severity: string;
      title: string;
      description: string;
    };
  };
}

export default function TestRunDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const runId = params.runId as string;
  const projectId = params.projectId as string;

  const { data: run, isLoading, refetch } = useTestRun(runId);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [liveStatus, setLiveStatus] = useState<string | null>(null);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed") {
      return;
    }

    // Connect to WebSocket for live updates
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsHost = ApiConfig.getBaseUrl().replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${wsHost}/api/v1/testing/runs/${runId}/ws`;

    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log("[TestRunDetail] WebSocket connected");
    };

    websocket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        switch (message.type) {
          case "status_update":
            if (message.data?.status) {
              setLiveStatus(message.data.status);
            }
            break;

          case "transition_complete":
          case "deficiency_found":
          case "coverage_update":
            // Refetch the full run data to get updated information
            refetch();
            break;

          case "run_complete":
            refetch();
            websocket.close();
            break;
        }
      } catch (error) {
        console.error("[TestRunDetail] Failed to parse WebSocket message:", error);
      }
    };

    websocket.onerror = (error) => {
      console.error("[TestRunDetail] WebSocket error:", error);
    };

    websocket.onclose = () => {
      console.log("[TestRunDetail] WebSocket disconnected");
    };

    return () => {
      websocket.close();
    };
  }, [run, runId, refetch]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const toggleStep = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  const handleExport = () => {
    if (!run) return;
    // Trigger export download
    const url = `${ApiConfig.getBaseUrl()}/api/v1/testing/runs/${runId}/export?format=json`;
    window.open(url, "_blank");
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!run) {
    return (
      <RequireProject pageName="Test Run Details">
        <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white flex items-center justify-center">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardContent className="p-12 text-center">
              <div className="text-red-400">Test run not found</div>
            </CardContent>
          </Card>
        </div>
      </RequireProject>
    );
  }

  const successRate =
    run.total_transitions > 0
      ? ((run.successful_transitions / run.total_transitions) * 100).toFixed(1)
      : "0";

  const displayStatus = liveStatus || run.status;

  return (
    <RequireProject pageName="Test Run Details">
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        {/* Header */}
        <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() =>
                  router.push(`/projects/${projectId}/testing/runs`)
                }
                className="text-gray-400 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                All Runs
              </Button>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
                Test Run Details
              </h1>
            </div>
            <Button
              onClick={handleExport}
              variant="outline"
              className="border-gray-700 hover:bg-gray-800"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          <div className="space-y-6">
            {/* Header Card with Run Metadata */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-2xl mb-2">
                      {run.workflow_name}
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                      Run ID: {run.id} • Started{" "}
                      {format(new Date(run.start_time), "MMM dd, yyyy HH:mm:ss")}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      displayStatus === "completed"
                        ? "success"
                        : displayStatus === "failed"
                          ? "destructive"
                          : "default"
                    }
                    className={
                      displayStatus === "running"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : ""
                    }
                  >
                    {displayStatus === "running" && (
                      <PlayCircle className="w-3 h-3 mr-1 animate-pulse" />
                    )}
                    {displayStatus}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                  <div className="space-y-2">
                    <div className="text-sm text-gray-400 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Duration
                    </div>
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
                      {run.successful_transitions} / {run.total_transitions}{" "}
                      transitions
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-400">Deficiencies</div>
                    <div className="text-2xl font-bold text-red-400">
                      {run.deficiencies_found}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-400">Runner</div>
                    <div className="text-sm font-mono truncate">
                      {run.runner_id.slice(0, 8)}...
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tabbed Content */}
            <Tabs defaultValue="timeline" className="w-full">
              <TabsList className="bg-[#1A1A1B]/50 border border-gray-800/50">
                <TabsTrigger value="timeline">Step Timeline</TabsTrigger>
                <TabsTrigger value="coverage">Coverage</TabsTrigger>
                <TabsTrigger value="deficiencies">
                  Deficiencies ({run.deficiencies_found})
                </TabsTrigger>
              </TabsList>

              {/* Timeline Tab */}
              <TabsContent value="timeline">
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                  <CardHeader>
                    <CardTitle>Execution Timeline</CardTitle>
                    <CardDescription>
                      Step-by-step breakdown of all transitions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-2">
                        {run.transitions.map((transition, index) => {
                          const isExpanded = expandedSteps.has(transition.id);
                          return (
                            <div
                              key={transition.id}
                              className={`rounded-lg border ${
                                transition.success
                                  ? "border-green-500/30 bg-green-500/5"
                                  : "border-red-500/30 bg-red-500/5"
                              }`}
                            >
                              <div
                                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/5"
                                onClick={() => toggleStep(transition.id)}
                              >
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0A0A0B]/50 flex items-center justify-center text-xs font-bold">
                                  {index + 1}
                                </div>
                                <div className="flex-shrink-0">
                                  {transition.success ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                  ) : (
                                    <XCircle className="w-5 h-5 text-red-500" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-sm">
                                      {transition.from_state}
                                    </span>
                                    <span className="text-gray-500">→</span>
                                    <span className="font-medium text-sm">
                                      {transition.to_state}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4 text-xs text-gray-400">
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {transition.action_type}
                                    </Badge>
                                    <span>{transition.duration_ms}ms</span>
                                    <span>
                                      {format(
                                        new Date(transition.executed_at),
                                        "HH:mm:ss.SSS"
                                      )}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {transition.screenshot_url && (
                                    <div className="flex-shrink-0">
                                      <Image
                                        src={transition.screenshot_url}
                                        alt="Transition screenshot"
                                        width={60}
                                        height={45}
                                        className="rounded border border-gray-700 cursor-pointer hover:border-[#00D9FF]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedImage(
                                            transition.screenshot_url
                                          );
                                        }}
                                      />
                                    </div>
                                  )}
                                  {isExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-gray-400" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 text-gray-400" />
                                  )}
                                </div>
                              </div>

                              {/* Expanded Details */}
                              {isExpanded && (
                                <div className="px-4 pb-4 space-y-3 border-t border-gray-800/50">
                                  <div className="grid grid-cols-2 gap-4 pt-3">
                                    <div>
                                      <div className="text-xs text-gray-400 mb-1">
                                        From State
                                      </div>
                                      <div className="text-sm font-mono">
                                        {transition.from_state}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-gray-400 mb-1">
                                        To State
                                      </div>
                                      <div className="text-sm font-mono">
                                        {transition.to_state}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-gray-400 mb-1">
                                        Action Type
                                      </div>
                                      <div className="text-sm">
                                        {transition.action_type}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-gray-400 mb-1">
                                        Duration
                                      </div>
                                      <div className="text-sm">
                                        {transition.duration_ms}ms
                                      </div>
                                    </div>
                                  </div>

                                  {transition.error_message && (
                                    <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                                      <div className="text-xs text-red-400 mb-1 font-semibold">
                                        Error
                                      </div>
                                      <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap">
                                        {transition.error_message}
                                      </pre>
                                    </div>
                                  )}

                                  {transition.screenshot_url && (
                                    <div>
                                      <div className="text-xs text-gray-400 mb-2">
                                        Screenshot
                                      </div>
                                      <div className="relative">
                                        <Image
                                          src={transition.screenshot_url}
                                          alt="Transition screenshot"
                                          width={400}
                                          height={300}
                                          className="rounded border border-gray-700 cursor-pointer hover:border-[#00D9FF]"
                                          onClick={() =>
                                            setSelectedImage(
                                              transition.screenshot_url
                                            )
                                          }
                                        />
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          className="absolute top-2 right-2"
                                          onClick={() =>
                                            setSelectedImage(
                                              transition.screenshot_url
                                            )
                                          }
                                        >
                                          <ZoomIn className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {run.transitions.length === 0 && (
                          <div className="text-center py-12 text-gray-400">
                            No transitions recorded yet
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Coverage Tab */}
              <TabsContent value="coverage">
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                  <CardHeader>
                    <CardTitle>State Coverage Summary</CardTitle>
                    <CardDescription>
                      How many times each state was visited
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-3">
                        {run.state_coverage.map((state) => {
                          const stateSuccessRate =
                            state.times_visited > 0
                              ? (
                                  (state.successful_visits /
                                    state.times_visited) *
                                  100
                                ).toFixed(0)
                              : "0";

                          return (
                            <div
                              key={state.state_name}
                              className="flex items-center justify-between p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/30"
                            >
                              <div className="flex-1">
                                <div className="font-medium mb-2">
                                  {state.state_name}
                                </div>
                                <div className="flex items-center gap-4 text-sm text-gray-400">
                                  <span>
                                    Visited: {state.times_visited} times
                                  </span>
                                  <span className="text-green-500">
                                    Success: {state.successful_visits}
                                  </span>
                                  <span className="text-red-400">
                                    Failed: {state.failed_visits}
                                  </span>
                                  <span>
                                    Avg: {state.average_duration_ms.toFixed(0)}
                                    ms
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-green-500"
                                    style={{
                                      width: `${stateSuccessRate}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-sm font-medium w-12 text-right">
                                  {stateSuccessRate}%
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {run.state_coverage.length === 0 && (
                          <div className="text-center py-12 text-gray-400">
                            No state coverage data yet
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Deficiencies Tab */}
              <TabsContent value="deficiencies">
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                  <CardHeader>
                    <CardTitle>Deficiencies Found</CardTitle>
                    <CardDescription>
                      Issues discovered during this test run
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[600px] pr-4">
                      {run.deficiencies.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
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
                                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                                  <span className="font-medium">
                                    {deficiency.title}
                                  </span>
                                </div>
                                <Badge
                                  variant={
                                    deficiency.severity === "critical" ||
                                    deficiency.severity === "high"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  className={
                                    deficiency.severity === "medium"
                                      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                                      : deficiency.severity === "low"
                                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                        : ""
                                  }
                                >
                                  {deficiency.severity}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-400 mb-3">
                                {deficiency.description}
                              </p>
                              <div className="text-xs text-gray-500 space-y-1">
                                <div>State: {deficiency.state_name}</div>
                                {deficiency.transition_from &&
                                  deficiency.transition_to && (
                                    <div>
                                      Transition: {deficiency.transition_from}{" "}
                                      → {deficiency.transition_to}
                                    </div>
                                  )}
                              </div>
                              {deficiency.error_message && (
                                <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded p-3">
                                  <div className="text-xs text-red-400 mb-1 font-semibold">
                                    Stack Trace
                                  </div>
                                  <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                                    {deficiency.error_message}
                                  </pre>
                                </div>
                              )}
                              {deficiency.screenshot_url && (
                                <div className="mt-3">
                                  <div className="text-xs text-gray-400 mb-2">
                                    Screenshot
                                  </div>
                                  <Image
                                    src={deficiency.screenshot_url}
                                    alt="Deficiency screenshot"
                                    width={200}
                                    height={150}
                                    className="rounded border border-gray-700 cursor-pointer hover:border-[#00D9FF]"
                                    onClick={() =>
                                      setSelectedImage(deficiency.screenshot_url)
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>

        {/* Image Zoom Dialog */}
        <Dialog
          open={selectedImage !== null}
          onOpenChange={() => setSelectedImage(null)}
        >
          <DialogContent className="max-w-4xl bg-[#1A1A1B] border-gray-800">
            <DialogHeader>
              <DialogTitle>Screenshot</DialogTitle>
            </DialogHeader>
            {selectedImage && (
              <div className="relative w-full">
                <Image
                  src={selectedImage}
                  alt="Full size screenshot"
                  width={1200}
                  height={800}
                  className="rounded border border-gray-700 w-full h-auto"
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </RequireProject>
  );
}
