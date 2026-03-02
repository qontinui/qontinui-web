"use client";

export const dynamic = "force-dynamic";

import { Loader2 } from "lucide-react";
import { IntegrationTestResults } from "@/components/testing/IntegrationTestResults";
import { IntegrationTestControlPanel } from "@/components/testing/IntegrationTestControlPanel";
import { VisualPlayback } from "@/components/testing/VisualPlayback";
import { RequireProject } from "@/components/require-project";
import { useIntegrationTestRuns } from "./_hooks/useIntegrationTestRuns";
import { useNameMap } from "./_hooks/useNameMap";
import { PageHeader } from "./_components/PageHeader";
import { ErrorBanner } from "./_components/ErrorBanner";
import { ApiOfflineBanner } from "./_components/ApiOfflineBanner";
import { EmptyState } from "./_components/EmptyState";
import { IntegrationTestRunsList } from "./_components/IntegrationTestRunsList";

export default function IntegrationTestingPage() {
  const {
    user,
    authLoading,
    projectId,
    projectLoading,
    workflows,
    states,
    selectedWorkflowId,
    setSelectedWorkflowId,
    initialStatesOverride,
    setInitialStatesOverride,
    runs,
    selectedRun,
    viewMode,
    loading,
    runningTest,
    error,
    apiHealthy,
    fetchRuns,
    loadRunDetails,
    runIntegrationTest,
    toggleViewMode,
    goBackToList,
    dismissError,
  } = useIntegrationTestRuns();

  const nameMap = useNameMap();

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="Integration Testing">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <PageHeader
          viewMode={viewMode}
          selectedRun={selectedRun}
          apiHealthy={apiHealthy}
          loading={loading}
          projectId={projectId}
          onGoBack={goBackToList}
          onToggleViewMode={toggleViewMode}
          onRefresh={fetchRuns}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {error && <ErrorBanner error={error} onDismiss={dismissError} />}

          {apiHealthy === false && viewMode === "list" && <ApiOfflineBanner />}

          {viewMode === "list" && (
            <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6">
              <div className="space-y-6">
                <IntegrationTestControlPanel
                  workflows={workflows}
                  states={states}
                  selectedWorkflowId={selectedWorkflowId}
                  onWorkflowSelect={setSelectedWorkflowId}
                  initialStatesOverride={initialStatesOverride}
                  onInitialStatesChange={setInitialStatesOverride}
                  isRunning={runningTest}
                  onRunTest={runIntegrationTest}
                  apiHealthy={apiHealthy}
                  isLoading={
                    (loading || projectLoading) && workflows.length === 0
                  }
                />
              </div>

              <div>
                <div className="mb-6">
                  <h2 className="text-xl font-bold mb-2">Test Run History</h2>
                  <p className="text-sm text-muted-foreground">
                    Previous integration test results using historical execution
                    data.
                  </p>
                </div>

                {loading && runs.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : runs.length === 0 ? (
                  <EmptyState />
                ) : (
                  <IntegrationTestRunsList
                    runs={runs}
                    onSelectRun={loadRunDetails}
                  />
                )}
              </div>
            </div>
          )}

          {viewMode === "detail" && selectedRun && (
            <IntegrationTestResults
              run={selectedRun}
              showPlaybackToggle={true}
              onToggleVisualMode={toggleViewMode}
              nameMap={nameMap}
            />
          )}

          {viewMode === "visual" && selectedRun && (
            <VisualPlayback
              run={selectedRun}
              onToggleVisualMode={toggleViewMode}
              nameMap={nameMap}
            />
          )}
        </main>
      </div>
    </RequireProject>
  );
}
