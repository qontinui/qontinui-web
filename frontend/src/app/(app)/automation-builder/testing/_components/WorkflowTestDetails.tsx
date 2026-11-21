import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TestCase } from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";

interface WorkflowTestDetailsProps {
  workflow: Workflow;
  testCases: TestCase[];
}

export function WorkflowTestDetails({
  workflow,
  testCases,
}: WorkflowTestDetailsProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{workflow.name}</CardTitle>
          <CardDescription>
            Test cases authored for this workflow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
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
