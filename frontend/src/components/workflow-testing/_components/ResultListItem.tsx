"use client";

import { CheckCircle2, XCircle, Clock, Info, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TestResult } from "@/services/workflow-testing-service";

interface ResultListItemProps {
  result: TestResult;
  onSelect: (result: TestResult) => void;
}

export function ResultListItem({ result, onSelect }: ResultListItemProps) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect(result)}
    >
      <CardContent className="py-4">
        <div className="flex items-center gap-4">
          {/* Status icon */}
          <div className="flex-shrink-0">
            {result.passed ? (
              <CheckCircle2 className="size-8 text-green-500" />
            ) : (
              <XCircle className="size-8 text-red-500" />
            )}
          </div>

          {/* Result info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={result.passed ? "default" : "destructive"}>
                {result.passed ? "Passed" : "Failed"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {new Date(result.startTime).toLocaleString()}
              </span>
            </div>

            {result.error && (
              <p className="text-sm text-destructive flex items-start gap-1 mb-2">
                <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                <span className="truncate">{result.error}</span>
              </p>
            )}

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-4" />
                {(result.duration / 1000).toFixed(2)}s
              </span>
              <span>
                {result.assertions.filter((a) => a.passed).length}/
                {result.assertions.length} assertions passed
              </span>
              {result.actionsExecuted !== undefined && (
                <span>{result.actionsExecuted} actions</span>
              )}
            </div>
          </div>

          {/* View details */}
          <Button variant="ghost" size="sm">
            <Info />
            Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
