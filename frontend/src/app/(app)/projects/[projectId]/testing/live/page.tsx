"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
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
import { Play, RefreshCw, Search, Filter, PlayCircle } from "lucide-react";
import { LiveTestDashboard } from "@/components/testing/LiveTestDashboard";
import { TestRunCard } from "@/components/testing/TestRunCard";
import { useTestRuns } from "@/hooks/useTesting";

function ProjectLiveTestingPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;

  const runIdFromUrl = searchParams.get("runId");
  const [activeTab, setActiveTab] = useState<"live" | "history">("live");
  const [activeTestRunId, setActiveTestRunId] = useState<string | undefined>(
    () => runIdFromUrl || undefined
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
    refetchTestRuns();
  };

  const handleViewRun = (runId: string) => {
    setActiveTestRunId(runId);
    setActiveTab("live");
    router.push(`/projects/${projectId}/testing/live?runId=${runId}`);
  };

  const handleStartNewTest = () => {
    console.log("Start new test");
  };

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">
          Live Testing Dashboard
        </h1>
        <Button onClick={handleStartNewTest} size="sm">
          <Play className="w-4 h-4 mr-2" />
          Start New Test
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "live" | "history")}
        >
          <TabsList className="mb-6">
            <TabsTrigger value="live">
              <PlayCircle className="w-4 h-4 mr-2" />
              Live Execution
            </TabsTrigger>
            <TabsTrigger value="history">
              <RefreshCw className="w-4 h-4 mr-2" />
              Test History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-6">
            {activeTestRunId ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-foreground">
                      Live Test Execution
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Real-time monitoring of test execution and results
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTestRunId(undefined)}
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
              <div className="p-12 text-center">
                <PlayCircle className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-medium text-foreground mb-2">
                  No Active Test
                </h3>
                <p className="text-muted-foreground mb-6">
                  Start a new test or select a running test from history to see
                  live results
                </p>
                <Button onClick={handleStartNewTest}>
                  <Play className="w-4 h-4 mr-2" />
                  Start New Test
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-foreground">
                Test History
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                View and analyze past test executions
              </p>
            </div>

            <Card className="bg-muted border-border">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
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
                      />
                      <Button onClick={() => refetchTestRuns()}>
                        <Search className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
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

            {testRunsLoading ? (
              <div className="p-12 text-center text-muted-foreground">
                Loading test runs...
              </div>
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
              <div className="p-12 text-center">
                <RefreshCw className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-medium text-foreground mb-2">
                  No Test Runs Found
                </h3>
                <p className="text-muted-foreground mb-6">
                  {searchQuery || statusFilter !== "all"
                    ? "No test runs match your filters. Try adjusting your search criteria."
                    : "Start your first test to see results here"}
                </p>
                {!searchQuery && statusFilter === "all" && (
                  <Button onClick={handleStartNewTest}>
                    <Play className="w-4 h-4 mr-2" />
                    Start First Test
                  </Button>
                )}
              </div>
            )}

            {testRunsData && testRunsData.total_pages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testRunsData.page === 1}
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

export default function ProjectLiveTestingPage() {
  return (
    <Suspense fallback={null}>
      <ProjectLiveTestingPageContent />
    </Suspense>
  );
}
