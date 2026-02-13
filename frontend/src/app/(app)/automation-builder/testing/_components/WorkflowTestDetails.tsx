import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type {
  TestCase,
  WorkflowCoverage,
} from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowTestDetailsProps {
  workflow: Workflow;
  testCases: TestCase[];
  coverage?: WorkflowCoverage;
}

export function WorkflowTestDetails({
  workflow,
  testCases,
  coverage,
}: WorkflowTestDetailsProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{workflow.name}</CardTitle>
          <CardDescription>Workflow test coverage and details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Coverage */}
            {coverage && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Coverage</span>
                  <span className="text-sm">
                    {coverage.coveragePercentage.toFixed(1)}%
                  </span>
                </div>
                <Progress value={coverage.coveragePercentage} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>
                    {coverage.coveredActions} / {coverage.totalActions} actions
                    covered
                  </span>
                </div>
              </div>
            )}

            {/* Test Cases */}
            <div>
              <h3 className="font-semibold mb-2">
                Test Cases ({testCases.length})
              </h3>
              {testCases.length > 0 ? (
                <div className="space-y-2">
                  {testCases.map((testCase) => (
                    <div
                      key={testCase.id}
                      className="text-sm p-2 border rounded-md"
                    >
                      {testCase.name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No test cases for this workflow yet
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
