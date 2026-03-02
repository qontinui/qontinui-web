import React from "react";
import type { TestResult } from "@/lib/runner-client";
import { TestResultItem } from "./TestResultItems";

interface TestResultsPanelProps {
  testResults: TestResult[];
  loading: boolean;
  onEndRun: () => void;
}

export function TestResultsPanel({
  testResults,
  loading,
  onEndRun,
}: TestResultsPanelProps) {
  return (
    <div className="border rounded-lg p-4 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">Test Results</h3>
        <button
          onClick={onEndRun}
          disabled={loading}
          className="text-sm text-red-600 hover:underline"
        >
          End Run
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {testResults.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No test results yet. Run some assertions.
          </p>
        ) : (
          testResults.map((result) => (
            <TestResultItem key={result.test_id} result={result} />
          ))
        )}
      </div>
    </div>
  );
}
