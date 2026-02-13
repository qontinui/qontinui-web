import * as React from "react";
import { CheckCircle2, XCircle, Minus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type {
  TestCase,
  TestSuite,
  TestResult,
} from "@/services/workflow-testing";

export function SuiteResults({
  testCases,
  testResults,
}: {
  suite?: TestSuite;
  testCases: TestCase[];
  testResults: Map<string, TestResult[]>;
}) {
  const results = React.useMemo(() => {
    return testCases.map((tc) => ({
      testCase: tc,
      result: testResults.get(tc.id)?.[0],
    }));
  }, [testCases, testResults]);

  const summary = React.useMemo(() => {
    const total = results.length;
    const run = results.filter((r) => r.result).length;
    const passed = results.filter((r) => r.result?.passed).length;
    const failed = results.filter((r) => r.result && !r.result.passed).length;

    return { total, run, passed, failed, notRun: total - run };
  }, [results]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Tests:</span>
            <span>{summary.total}</span>
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
            <span className="text-muted-foreground">Not Run:</span>
            <span>{summary.notRun}</span>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-2">Test Results</h3>
        <div className="space-y-2">
          {results.map(({ testCase, result }) => (
            <div key={testCase.id} className="text-sm p-2 border rounded-md">
              <div className="flex items-center gap-2">
                {result ? (
                  result.passed ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : (
                    <XCircle className="size-4 text-red-500" />
                  )
                ) : (
                  <Minus className="size-4 text-muted-foreground" />
                )}
                <span className="flex-1">{testCase.name}</span>
              </div>
              {result && (
                <div className="text-xs text-muted-foreground mt-1">
                  {result.duration}ms
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
