"use client";

import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import { useFindingsSummary } from "@/hooks/useTaskRunData";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Inbox } from "lucide-react";

import { useFindingsFilters } from "./_hooks/useFindingsFilters";
import { useFindingsActions } from "./_hooks/useFindingsActions";
import { FindingsHeader } from "./_components/FindingsHeader";
import { FindingsSummaryCards } from "./_components/FindingsSummaryCards";
import { CategoryBreakdown } from "./_components/CategoryBreakdown";
import { FindingsFilters } from "./_components/FindingsFilters";
import { FindingsList } from "./_components/FindingsList";

export default function FindingsPage() {
  const discoveredSpec = useDiscoveredSpec("findings");
  usePageSpecs(
    discoveredSpec ? { findings: discoveredSpec.config as SpecConfig } : {}
  );
  const { data, isLoading, error, isRunnerOffline, refetch } =
    useFindingsSummary();

  const {
    severityFilter,
    setSeverityFilter,
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    categories,
    filteredFindings,
  } = useFindingsFilters(data);

  const {
    autoFixEnabled,
    isFixing,
    toggleAutoFix,
    handleFixAll,
    handleClearAll,
    handleResolveFinding,
  } = useFindingsActions(data, isRunnerOffline, refetch);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <FindingsHeader
        autoFixEnabled={autoFixEnabled}
        isFixing={isFixing}
        hasFindings={!!data && data.total > 0}
        onToggleAutoFix={toggleAutoFix}
        onFixAll={handleFixAll}
        onClearAll={handleClearAll}
        onRefresh={refetch}
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          Aggregated findings across all task runs, organized by severity and
          category.
        </p>

        {isRunnerOffline && (
          <RunnerPartialState message="Runner offline — showing historical findings. Fix/resolve actions require the runner." />
        )}

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Loading findings...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading findings: {error?.message ?? "Unknown error"}
          </div>
        ) : !data || data.total === 0 ? (
          <Card className="bg-muted">
            <CardContent className="py-16">
              <div className="text-center text-muted-foreground">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">
                  No Findings Yet
                </h3>
                <p className="text-sm">
                  Findings are generated when the AI analyzes issues during task
                  runs.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <FindingsSummaryCards data={data} />

            <CategoryBreakdown
              byCategory={data.by_category}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
            />

            <FindingsFilters
              severityFilter={severityFilter}
              onSeverityChange={setSeverityFilter}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              statusFilter={statusFilter}
              onStatusChange={setStatusFilter}
              categories={categories}
            />

            <FindingsList
              findings={filteredFindings}
              onResolveFinding={handleResolveFinding}
            />
          </>
        )}
      </main>
    </div>
  );
}
