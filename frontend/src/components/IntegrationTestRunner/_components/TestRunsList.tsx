import React from "react";
import type { TestRunSummary } from "@/lib/runner-client";

interface TestRunsListProps {
  testRuns: TestRunSummary[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onRefresh: () => void;
}

export function TestRunsList({
  testRuns,
  selectedRunId,
  onSelectRun,
  onRefresh,
}: TestRunsListProps) {
  return (
    <div className="border rounded-lg p-4 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">Recent Test Runs</h3>
        <button
          onClick={onRefresh}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {testRuns.length === 0 ? (
          <p className="text-gray-500 text-sm">No test runs yet</p>
        ) : (
          testRuns.map((run) => (
            <div
              key={run.run_id}
              role="option"
              tabIndex={0}
              aria-selected={selectedRunId === run.run_id}
              onClick={() => onSelectRun(run.run_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRun(run.run_id);
                }
              }}
              className={`p-2 rounded cursor-pointer border ${
                selectedRunId === run.run_id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{run.name}</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    run.status === "passed"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : run.status === "failed"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  {run.status}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {run.passed}/{run.test_count} passed
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
