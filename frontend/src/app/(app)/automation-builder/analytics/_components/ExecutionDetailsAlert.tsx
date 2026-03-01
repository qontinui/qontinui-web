"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Activity, X } from "lucide-react";
import { formatDuration } from "../analytics-utils";
import type { ExecutionRecord } from "../analytics-types";

interface ExecutionDetailsAlertProps {
  execution: ExecutionRecord;
  onClose: () => void;
}

export function ExecutionDetailsAlert({
  execution,
  onClose,
}: ExecutionDetailsAlertProps) {
  return (
    <Alert className="fixed bottom-4 right-4 w-96 bg-muted border-border">
      <Activity className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        Execution Details
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-2 mt-2">
          <p className="text-sm font-medium">{execution.workflowName}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(execution.startTime).toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={execution.success ? "default" : "destructive"}>
              {execution.success ? "Success" : "Failed"}
            </Badge>
            <Badge variant="outline">
              {formatDuration(execution.duration)}
            </Badge>
          </div>
          {execution.error && (
            <div className="mt-2 p-2 rounded bg-red-500/10 text-xs">
              {execution.error}
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
