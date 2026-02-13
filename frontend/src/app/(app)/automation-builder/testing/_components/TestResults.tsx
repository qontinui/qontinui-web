import * as React from "react";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TestCase, TestResult } from "@/services/workflow-testing";

export function TestResults({
  results,
}: {
  testCase?: TestCase;
  results: TestResult[];
}) {
  const lastResult = results[0];
  const stats = React.useMemo(() => {
    if (results.length === 0) return null;

    const passed = results.filter((r) => r.passed).length;
    const durations = results.map((r) => r.duration);

    return {
      totalRuns: results.length,
      passRate: (passed / results.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
    };
  }, [results]);

  if (!lastResult) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <Clock className="size-12 mx-auto mb-4 opacity-50" />
        <p className="text-sm">No test results yet</p>
        <p className="text-xs mt-2">Run this test to see results</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Latest Result */}
      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          Latest Result
          {lastResult.passed ? (
            <CheckCircle2 className="size-4 text-green-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status:</span>
            <span
              className={lastResult.passed ? "text-green-500" : "text-red-500"}
            >
              {lastResult.passed ? "Passed" : "Failed"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration:</span>
            <span>{lastResult.duration}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Executed:</span>
            <span>{new Date(lastResult.endTime).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Assertions */}
      <div>
        <h3 className="font-semibold mb-2">Assertions</h3>
        <div className="space-y-2">
          {lastResult.assertions.map((assertion, i) => (
            <div
              key={i}
              className={cn(
                "text-sm p-2 border rounded-md flex items-start gap-2",
                assertion.passed
                  ? "bg-green-50 dark:bg-green-950/20"
                  : "bg-red-50 dark:bg-red-950/20"
              )}
            >
              {assertion.passed ? (
                <CheckCircle2 className="size-4 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="size-4 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-medium">{assertion.assertion.type}</div>
                {assertion.error && (
                  <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                    {assertion.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Statistics */}
      {stats && (
        <div>
          <h3 className="font-semibold mb-2">Statistics</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Runs:</span>
              <span>{stats.totalRuns}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pass Rate:</span>
              <span>{stats.passRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg Duration:</span>
              <span>{stats.avgDuration.toFixed(0)}ms</span>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="font-semibold mb-2">History</h3>
        <div className="space-y-1">
          {results.slice(0, 10).map((result) => (
            <div
              key={result.id}
              className="text-xs flex items-center justify-between p-1.5 rounded hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle2 className="size-3 text-green-500" />
                ) : (
                  <XCircle className="size-3 text-red-500" />
                )}
                <span>{new Date(result.endTime).toLocaleString()}</span>
              </div>
              <span className="text-muted-foreground">{result.duration}ms</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
