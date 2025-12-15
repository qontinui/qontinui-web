"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Play,
  RefreshCw,
  Search,
  Filter,
  PlayCircle,
} from "lucide-react";
import { LiveTestDashboard } from "@/components/testing/LiveTestDashboard";
import { TestRunCard } from "@/components/testing/TestRunCard";
import { useTestRuns } from "@/hooks/useTesting";

export default function ProjectLiveTestingPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;

  // Derive initial state from URL params
  const runIdFromUrl = searchParams.get("runId");
  const [activeTab, setActiveTab] = useState<"live" | "history">(() =>
    runIdFromUrl ? "live" : "live"
  );
  const [activeTestRunId, setActiveTestRunId] = useState<string | undefined>(
    () => runIdFromUrl || undefined
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch test runs
  const {
    data: testRunsData,
    isLoading: testRunsLoading,
    refetch: refetchTestRuns,
  } = useTestRuns({
    project_id: projectId,
    status:
      statusFilter === "all"
        ? undefined
        : (statusFilter as "running" | "completed" | "failed"),
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const handleTestComplete = () => {
    // Refresh test runs list when a test completes
    refetchTestRuns();
  };

  const handleViewRun = (runId: string) => {
    setActiveTestRunId(runId);
    setActiveTab("live");
    router.push(`/projects/${projectId}/testing/live?runId=${runId}`);
  };

  const handleStartNewTest = () => {
    // This would typically open a dialog or navigate to test configuration
    console.log("Start new test");
  };

  if (authLoading) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push(`/projects/${projectId}/testing`)}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Testing
            </Button>
            <div className="h-6 w-px bg-gray-700" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Live Testing Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleStartNewTest}
              className="bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] hover:opacity-90 text-black font-medium"
            >
              <Play className="w-4 h-4 mr-2" />
              Start New Test
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-[1800px] mx-auto">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "live" | "history")}
        >
          <TabsList className="bg-[#1A1A1B]/50 border border-gray-800/50 mb-6">
            <TabsTrigger
              value="live"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#00D9FF] data-[state=active]:to-[#BD00FF] data-[state=active]:text-black"
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              Live Execution
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#00D9FF] data-[state=active]:to-[#BD00FF] data-[state=active]:text-black"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Test History
            </TabsTrigger>
          </TabsList>

          {/* Live Execution Tab */}
          <TabsContent value="live" className="space-y-6">
            {activeTestRunId ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-white">
                      Live Test Execution
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      Real-time monitoring of test execution and results
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTestRunId(undefined)}
                    className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                  >
                    Clear Selection
                  </Button>
                </div>

                <LiveTestDashboard
                  testRunId={activeTestRunId}
                  onComplete={handleTestComplete}
                />
              </>
            ) : (
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                <CardContent className="p-12 text-center">
                  <PlayCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-white mb-2">
                    No Active Test
                  </h3>
                  <p className="text-gray-400 mb-6">
                    Start a new test or select a running test from history to
                    see live results
                  </p>
                  <Button
                    onClick={handleStartNewTest}
                    className="bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] hover:opacity-90 text-black font-medium"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Start New Test
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Test History Tab */}
          <TabsContent value="history" className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-white">Test History</h2>
              <p className="text-sm text-gray-400 mt-1">
                View and analyze past test executions
              </p>
            </div>

            {/* Filters */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <CardTitle className="text-base">Filters</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Search test runs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-[#0A0A0B]/50 border-gray-700 focus:border-[#00D9FF]"
                      />
                      <Button
                        onClick={() => refetchTestRuns()}
                        className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                      >
                        <Search className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="bg-[#0A0A0B]/50 border-gray-700">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="running">Running</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Test Runs List */}
            {testRunsLoading ? (
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                <CardContent className="p-12 text-center">
                  <div className="text-gray-400">Loading test runs...</div>
                </CardContent>
              </Card>
            ) : testRunsData?.items && testRunsData.items.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {testRunsData.items.map((run) => (
                  <TestRunCard
                    key={run.id}
                    runId={run.id}
                    workflowName={run.workflow_name}
                    status={run.status as "running" | "completed" | "failed"}
                    startTime={new Date(run.start_time)}
                    duration={run.duration_seconds ?? undefined}
                    coveragePercentage={run.coverage_percentage}
                    statesCovered={run.states_covered}
                    totalStates={run.total_states}
                    successfulTransitions={run.successful_transitions}
                    totalTransitions={run.total_transitions}
                    deficienciesFound={run.deficiencies_found}
                    onClick={() => handleViewRun(run.id)}
                  />
                ))}
              </div>
            ) : (
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                <CardContent className="p-12 text-center">
                  <RefreshCw className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-xl font-medium text-white mb-2">
                    No Test Runs Found
                  </h3>
                  <p className="text-gray-400 mb-6">
                    {searchQuery || statusFilter !== "all"
                      ? "No test runs match your filters. Try adjusting your search criteria."
                      : "Start your first test to see results here"}
                  </p>
                  {!searchQuery && statusFilter === "all" && (
                    <Button
                      onClick={handleStartNewTest}
                      className="bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] hover:opacity-90 text-black font-medium"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start First Test
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pagination */}
            {testRunsData && testRunsData.total_pages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testRunsData.page === 1}
                  className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                >
                  Previous
                </Button>
                <Badge variant="outline" className="px-4">
                  Page {testRunsData.page} of {testRunsData.total_pages}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testRunsData.page === testRunsData.total_pages}
                  className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                >
                  Next
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
