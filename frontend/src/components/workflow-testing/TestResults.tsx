"use client";

import { Play, Download, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTestResults } from "./_hooks/useTestResults";
import { StatisticsCards } from "./_components/StatisticsCards";
import { PassRateChart } from "./_components/PassRateChart";
import { ResultsControls } from "./_components/ResultsControls";
import { ResultListItem } from "./_components/ResultListItem";
import { EmptyResults } from "./_components/EmptyResults";
import { ResultDetailsDialog } from "./_components/ResultDetailsDialog";
import type { TestResultsProps } from "./test-results-types";

export type { TestResultsProps };

export function TestResults({
  testCase,
  results,
  onRunTest,
  onClearResults,
  className,
}: TestResultsProps) {
  const {
    sortField,
    sortOrder,
    filterStatus,
    setFilterStatus,
    selectedResult,
    setSelectedResult,
    isRunning,
    statistics,
    trend,
    filteredAndSortedResults,
    passRateHistory,
    handleRunTest,
    handleClearResults,
    handleExportResults,
    toggleSort,
  } = useTestResults(testCase, results, onRunTest, onClearResults);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Test Results</CardTitle>
              <CardDescription>{testCase.name}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleRunTest} disabled={isRunning}>
                {isRunning ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Running
                  </>
                ) : (
                  <>
                    <Play />
                    Run Test
                  </>
                )}
              </Button>
              {results.length > 0 && (
                <>
                  <Button onClick={handleExportResults} variant="outline">
                    <Download />
                    Export
                  </Button>
                  <Button onClick={handleClearResults} variant="ghost">
                    <Trash2 />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {statistics && <StatisticsCards statistics={statistics} trend={trend} />}

      <PassRateChart passRateHistory={passRateHistory} />

      {results.length > 0 && (
        <ResultsControls
          filterStatus={filterStatus}
          onFilterChange={setFilterStatus}
          sortField={sortField}
          sortOrder={sortOrder}
          onToggleSort={toggleSort}
        />
      )}

      {filteredAndSortedResults.length === 0 ? (
        <EmptyResults
          hasResults={results.length > 0}
          isRunning={isRunning}
          onRunTest={handleRunTest}
        />
      ) : (
        <div className="space-y-3">
          {filteredAndSortedResults.map((result) => (
            <ResultListItem
              key={result.id}
              result={result}
              onSelect={setSelectedResult}
            />
          ))}
        </div>
      )}

      {selectedResult && (
        <ResultDetailsDialog
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </div>
  );
}
