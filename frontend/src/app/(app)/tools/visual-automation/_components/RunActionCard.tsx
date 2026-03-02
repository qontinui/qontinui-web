import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Loader2 } from "lucide-react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

interface RunActionCardProps {
  workflow: UnifiedWorkflow;
  isRunning: boolean;
  isGuiLocked: boolean;
  onRun: () => void;
}

export function RunActionCard({
  workflow,
  isRunning,
  isGuiLocked,
  onRun,
}: RunActionCardProps) {
  return (
    <Card className="bg-muted border-border">
      <CardContent className="py-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-foreground">{workflow.name}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {workflow.description ?? "Ready to execute"}
            </p>
          </div>
          <Button
            onClick={onRun}
            disabled={isRunning || isGuiLocked}
            className="bg-primary hover:bg-primary/90 text-black font-semibold px-6"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Starting...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Run
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
