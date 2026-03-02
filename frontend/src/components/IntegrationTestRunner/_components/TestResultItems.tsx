import React from "react";
import type { TestResult, AssertionResult } from "@/lib/runner-client";

function AssertionResultItem({ assertion }: { assertion: AssertionResult }) {
  return (
    <div
      className={`p-2 rounded text-sm ${
        assertion.passed
          ? "bg-green-100 dark:bg-green-900/30 border-green-300"
          : "bg-red-100 dark:bg-red-900/30 border-red-300"
      } border`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`font-medium ${
            assertion.passed
              ? "text-green-700 dark:text-green-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {assertion.passed ? "PASS" : "FAIL"}
        </span>
        <span className="text-gray-600 dark:text-gray-400">
          {assertion.type}: {assertion.target}
        </span>
      </div>
      {assertion.actual_value && (
        <div className="text-xs text-gray-500 mt-1">
          Actual: {assertion.actual_value}
        </div>
      )}
      {assertion.error_message && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
          Error: {assertion.error_message}
        </div>
      )}
    </div>
  );
}

export function TestResultItem({ result }: { result: TestResult }) {
  return (
    <div className="border rounded-lg p-4 mb-4 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium">{result.test_name}</h4>
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            result.status === "passed"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : result.status === "failed"
                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {result.status.toUpperCase()}
        </span>
      </div>
      {result.duration_ms && (
        <div className="text-sm text-gray-500 mb-2">
          Duration: {result.duration_ms.toFixed(0)}ms
        </div>
      )}
      {result.error_message && (
        <div className="text-sm text-red-600 dark:text-red-400 mb-2">
          Error: {result.error_message}
        </div>
      )}
      <div className="space-y-2">
        {result.assertions.map((assertion) => (
          <AssertionResultItem
            key={assertion.assertion_id}
            assertion={assertion}
          />
        ))}
      </div>
    </div>
  );
}
