"use client";

import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  TestResult,
  AssertionResult,
} from "@/services/workflow-testing-service";

interface ResultDetailsDialogProps {
  result: TestResult;
  onClose: () => void;
}

export function ResultDetailsDialog({
  result,
  onClose,
}: ResultDetailsDialogProps) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {result.passed ? (
              <CheckCircle2 className="size-6 text-green-500" />
            ) : (
              <XCircle className="size-6 text-red-500" />
            )}
            <DialogTitle>Test Result Details</DialogTitle>
          </div>
          <DialogDescription>
            {result.testCaseName} -{" "}
            {new Date(result.startTime).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge
                    variant={result.passed ? "default" : "destructive"}
                    className="ml-2"
                  >
                    {result.passed ? "Passed" : "Failed"}
                  </Badge>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    Duration
                  </span>
                  <p className="font-medium">
                    {(result.duration / 1000).toFixed(2)}s
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    Start Time
                  </span>
                  <p className="font-medium">
                    {new Date(result.startTime).toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    End Time
                  </span>
                  <p className="font-medium">
                    {new Date(result.endTime).toLocaleString()}
                  </p>
                </div>
              </div>

              {result.error && (
                <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <p className="text-sm font-medium text-destructive mb-1">
                    Error
                  </p>
                  <p className="text-sm">{result.error}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assertions */}
          <Card>
            <CardHeader>
              <CardTitle>
                Assertions ({result.assertions.filter((a) => a.passed).length}/
                {result.assertions.length} passed)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {result.assertions.map((assertion, index) => (
                  <AssertionResultCard key={index} assertion={assertion} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Execution Path */}
          {result.executionPath && result.executionPath.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Execution Path</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {result.executionPath.map((actionId, index) => (
                    <React.Fragment key={index}>
                      <Badge variant="outline">{actionId}</Badge>
                      {index < result.executionPath!.length - 1 && (
                        <span className="text-muted-foreground">→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Final State */}
          {result.finalState && (
            <Card>
              <CardHeader>
                <CardTitle>Final State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {result.finalState.variables &&
                    Object.keys(result.finalState.variables).length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Variables</h4>
                        <pre className="text-sm bg-muted p-3 rounded-md overflow-x-auto">
                          {JSON.stringify(result.finalState.variables, null, 2)}
                        </pre>
                      </div>
                    )}

                  {result.finalState.activeStates &&
                    result.finalState.activeStates.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Active States</h4>
                        <div className="flex flex-wrap gap-2">
                          {result.finalState.activeStates.map((state) => (
                            <Badge key={state} variant="secondary">
                              {state}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssertionResultCard({ assertion }: { assertion: AssertionResult }) {
  return (
    <div
      className={cn(
        "p-3 rounded-md border",
        assertion.passed
          ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
          : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
      )}
    >
      <div className="flex items-start gap-2">
        {assertion.passed ? (
          <CheckCircle2 className="size-5 text-green-500 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {assertion.assertion.type}
            </Badge>
            {assertion.assertion.path && (
              <span className="text-xs text-muted-foreground font-mono">
                {assertion.assertion.path}
              </span>
            )}
          </div>

          {assertion.assertion.description && (
            <p className="text-sm mb-2">{assertion.assertion.description}</p>
          )}

          {!assertion.passed && assertion.error && (
            <p className="text-sm text-destructive">{assertion.error}</p>
          )}

          {assertion.actualValue !== undefined && (
            <div className="text-xs font-mono mt-2">
              <span className="text-muted-foreground">Actual: </span>
              <span>{JSON.stringify(assertion.actualValue)}</span>
            </div>
          )}

          {assertion.assertion.expected !== undefined && (
            <div className="text-xs font-mono">
              <span className="text-muted-foreground">Expected: </span>
              <span>{JSON.stringify(assertion.assertion.expected)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
