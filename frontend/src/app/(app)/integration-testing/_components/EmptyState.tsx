import { Activity } from "lucide-react";

export function EmptyState() {
  return (
    <div className="py-12 text-center">
      <Activity className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
      <h3 className="text-xl font-medium text-foreground mb-2">
        No Integration Tests Yet
      </h3>
      <p className="text-muted-foreground mb-4 max-w-md mx-auto">
        Select a workflow from the configuration panel and run your first
        integration test. Tests run in mock mode using historical data.
      </p>
    </div>
  );
}
