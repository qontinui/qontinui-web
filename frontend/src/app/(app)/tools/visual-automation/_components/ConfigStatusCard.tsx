import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

interface ConfigStatusCardProps {
  selectedWorkflow: UnifiedWorkflow | null;
  onUnload: () => void;
}

export function ConfigStatusCard({
  selectedWorkflow,
  onUnload,
}: ConfigStatusCardProps) {
  return (
    <Card className="bg-muted border-border">
      <CardContent className="py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {selectedWorkflow ? selectedWorkflow.name : "No config loaded"}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedWorkflow
                  ? "Active configuration"
                  : "Select a workflow to begin"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedWorkflow ? (
              <>
                <Badge variant="success" className="text-xs gap-1">
                  <div className="size-1.5 rounded-full bg-white" />
                  Active
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onUnload}
                  className="text-muted-foreground text-xs"
                >
                  Unload
                </Button>
              </>
            ) : (
              <Badge variant="secondary" className="text-xs">
                No Config
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
