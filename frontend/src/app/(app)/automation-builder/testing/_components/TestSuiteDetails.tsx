import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TestCase, TestSuite } from "@/services/workflow-testing";

interface TestSuiteDetailsProps {
  suite: TestSuite;
  testCases: TestCase[];
  onEdit: () => void;
}

export function TestSuiteDetails({
  suite,
  testCases,
  onEdit,
}: TestSuiteDetailsProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{suite.name}</CardTitle>
              {suite.description && (
                <CardDescription>{suite.description}</CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={onEdit} variant="outline" size="sm">
                <Settings className="size-4" />
                Edit
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Settings */}
            <div className="flex gap-2">
              <Badge variant="outline">
                {suite.executionOrder === "parallel"
                  ? "Parallel"
                  : "Sequential"}
              </Badge>
              {suite.stopOnFailure && (
                <Badge variant="outline">Stop on Failure</Badge>
              )}
            </div>

            {/* Test Cases */}
            <div>
              <h3 className="font-semibold mb-2">
                Test Cases ({testCases.length})
              </h3>
              <div className="space-y-2">
                {testCases.map((testCase) => (
                  <div
                    key={testCase.id}
                    className="text-sm p-3 border rounded-md flex items-center justify-between"
                  >
                    <span>{testCase.name}</span>
                    {!testCase.enabled && (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
