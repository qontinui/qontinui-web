import {
  Play,
  CheckCircle2,
  XCircle,
  Settings,
  Copy,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TestCase, TestResult } from "@/services/workflow-testing";

interface TestCaseDetailsProps {
  testCase: TestCase;
  results: TestResult[];
  onRun: (id: string) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  isRunning: boolean;
}

export function TestCaseDetails({
  testCase,
  results,
  onRun,
  onEdit,
  onDuplicate,
  onDelete,
  isRunning,
}: TestCaseDetailsProps) {
  const lastResult = results[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle>{testCase.name}</CardTitle>
              {testCase.description && (
                <CardDescription>{testCase.description}</CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => onRun(testCase.id)}
                variant="default"
                size="sm"
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Run
              </Button>
              <Button
                onClick={() => onEdit(testCase)}
                variant="outline"
                size="sm"
              >
                <Settings className="size-4" />
                Edit
              </Button>
              <Button
                onClick={() => onDuplicate(testCase.id)}
                variant="outline"
                size="sm"
              >
                <Copy className="size-4" />
                Clone
              </Button>
              <Button
                onClick={() => onDelete(testCase.id)}
                variant="ghost"
                size="sm"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Status */}
            {lastResult && (
              <div className="flex items-center gap-2">
                {lastResult.passed ? (
                  <CheckCircle2 className="size-5 text-green-500" />
                ) : (
                  <XCircle className="size-5 text-red-500" />
                )}
                <span className="font-medium">
                  Last Run: {lastResult.passed ? "Passed" : "Failed"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {new Date(lastResult.endTime).toLocaleString()}
                </span>
              </div>
            )}

            {/* Configuration */}
            <div>
              <h3 className="font-semibold mb-2">Configuration</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assertions:</span>
                  <span>{testCase.config.assertions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeout:</span>
                  <span>{testCase.config.timeout || 60000}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Enabled:</span>
                  <span>{testCase.enabled !== false ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            {/* Tags */}
            {testCase.config.tags && testCase.config.tags.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {testCase.config.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Assertions */}
            <div>
              <h3 className="font-semibold mb-2">Assertions</h3>
              <div className="space-y-2">
                {testCase.config.assertions.map((assertion) => (
                  <div
                    key={assertion.id}
                    className="text-sm p-2 border rounded-md bg-accent/50"
                  >
                    <div className="font-medium">{assertion.type}</div>
                    {assertion.description && (
                      <div className="text-muted-foreground">
                        {assertion.description}
                      </div>
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
