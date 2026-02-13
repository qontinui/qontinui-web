import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { TestResult } from "@/services/workflow-testing";

export function ExecutionResults({ results }: { results: TestResult[] }) {
  const summary = React.useMemo(() => {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    return { passed, failed, totalDuration };
  }, [results]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Execution Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Tests:</span>
            <span>{results.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-600 dark:text-green-400">Passed:</span>
            <span>{summary.passed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-600 dark:text-red-400">Failed:</span>
            <span>{summary.failed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Duration:</span>
            <span>{summary.totalDuration}ms</span>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-2">Results</h3>
        <div className="space-y-2">
          {results.map((result) => (
            <div key={result.id} className="text-sm p-2 border rounded-md">
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle2 className="size-4 text-green-500" />
                ) : (
                  <XCircle className="size-4 text-red-500" />
                )}
                <span className="flex-1">{result.testCaseName}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {result.duration}ms
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
