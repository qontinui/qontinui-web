"use client";

import { BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  TestCase,
  TestSuite,
  TestResult,
} from "@/services/workflow-testing";
import { TestResults } from "./TestResults";
import { SuiteResults } from "./SuiteResults";
import { ExecutionResults } from "./ExecutionResults";

interface TestResultsViewProps {
  selectedTestCase: TestCase | null;
  selectedSuite: TestSuite | null;
  testCases: TestCase[];
  testResults: Map<string, TestResult[]>;
  executionResults: TestResult[];
}

/**
 * Right sidebar panel that displays test results contextually:
 * - Individual test results when a test case is selected
 * - Suite results when a suite is selected
 * - Execution results after a batch run
 * - Empty state otherwise
 */
export function TestResultsView({
  selectedTestCase,
  selectedSuite,
  testCases,
  testResults,
  executionResults,
}: TestResultsViewProps) {
  return (
    <Card className="flex-1 flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">Test Results</CardTitle>
        <CardDescription>Latest results and statistics</CardDescription>
      </CardHeader>
      <ScrollArea className="flex-1">
        <CardContent>
          {selectedTestCase ? (
            <TestResults
              testCase={selectedTestCase}
              results={testResults.get(selectedTestCase.id) || []}
            />
          ) : selectedSuite ? (
            <SuiteResults
              suite={selectedSuite}
              testCases={testCases.filter((tc) =>
                selectedSuite.testCaseIds.includes(tc.id)
              )}
              testResults={testResults}
            />
          ) : executionResults.length > 0 ? (
            <ExecutionResults results={executionResults} />
          ) : (
            <div className="text-center text-muted-foreground py-12">
              <BarChart3 className="size-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">
                Select a test or suite to view results
              </p>
            </div>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
