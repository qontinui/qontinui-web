import { Play, Settings, Loader2 } from "lucide-react";
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
  onRun: (id: string) => void;
  onEdit: () => void;
  isRunning: boolean;
}

export function TestSuiteDetails({
  suite,
  testCases,
  onRun,
  onEdit,
  isRunning,
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
              <Button
                onClick={() => onRun(suite.id)}
                variant="default"
                size="sm"
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Run Suite
              </Button>
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
