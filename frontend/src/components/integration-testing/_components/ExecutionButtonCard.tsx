"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Square } from "lucide-react";

interface ExecutionButtonCardProps {
  isExecuting: boolean;
  disabled: boolean;
  onExecute: () => void;
  onStop?: () => void;
}

export function ExecutionButtonCard({
  isExecuting,
  disabled,
  onExecute,
  onStop,
}: ExecutionButtonCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        {!isExecuting ? (
          <Button onClick={onExecute} disabled={disabled} className="w-full">
            <Play className="w-4 h-4 mr-2" />
            Execute Process
          </Button>
        ) : (
          <Button onClick={onStop} variant="destructive" className="w-full">
            <Square className="w-4 h-4 mr-2" />
            Stop Execution
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
