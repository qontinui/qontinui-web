import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

export function EmptyStateCard() {
  return (
    <Card className="bg-muted border-border">
      <CardContent className="py-12">
        <div className="text-center">
          <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium text-muted-foreground mb-2">
            Select a Workflow to Execute
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Choose a workflow from the list above, then click Run to start
            execution on the connected runner. You can monitor progress in the
            live dashboard.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
