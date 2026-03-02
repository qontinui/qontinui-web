import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

interface GuiLockStatusCardProps {
  isGuiLocked: boolean;
}

export function GuiLockStatusCard({ isGuiLocked }: GuiLockStatusCardProps) {
  return (
    <Card className="bg-muted border-border">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">GUI Status</p>
              <p className="text-xs text-muted-foreground">
                {isGuiLocked
                  ? "A visual automation workflow is using the GUI"
                  : "Ready to execute workflows"}
              </p>
            </div>
          </div>
          <Badge variant={isGuiLocked ? "warning" : "info"}>
            {isGuiLocked ? "locked" : "available"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
