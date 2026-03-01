"use client";

import { Play, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";

interface ActionFooterCardProps {
  isRunning: boolean;
  onRun: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ActionFooterCard({
  isRunning,
  onRun,
  onSave,
  onCancel,
}: ActionFooterCardProps) {
  return (
    <Card>
      <CardFooter className="flex justify-between">
        <Button onClick={onCancel} variant="outline">
          <X />
          Cancel
        </Button>
        <div className="flex gap-2">
          <Button onClick={onRun} variant="secondary" disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play />
                Run Test
              </>
            )}
          </Button>
          <Button onClick={onSave}>
            <Save />
            Save
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
