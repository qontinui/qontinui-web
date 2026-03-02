import { Activity } from "lucide-react";
import { EmptyState as BaseEmptyState } from "@/components/common/_components/EmptyState";

export function EmptyState() {
  return (
    <BaseEmptyState
      icon={Activity}
      message="No Integration Tests Yet"
      detail="Select a workflow from the configuration panel and run your first integration test. Tests run in mock mode using historical data."
    />
  );
}
