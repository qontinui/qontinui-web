"use client";

import { FileText, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyResultsProps {
  hasResults: boolean;
  isRunning: boolean;
  onRunTest: () => void;
}

export function EmptyResults({
  hasResults,
  isRunning,
  onRunTest,
}: EmptyResultsProps) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <FileText className="size-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">No test results</h3>
        <p className="text-muted-foreground mb-4">
          {!hasResults
            ? "Run this test to see results"
            : "No results match your filters"}
        </p>
        {!hasResults && (
          <Button onClick={onRunTest} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="animate-spin" />
                Running
              </>
            ) : (
              <>
                <Play />
                Run Test
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
