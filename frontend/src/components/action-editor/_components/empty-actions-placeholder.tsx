import { Plus } from "lucide-react";

export function EmptyActionsPlaceholder() {
  return (
    <div className="text-center py-12 text-text-muted border-2 border-dashed border-border-default rounded-lg">
      <Plus className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p>No actions yet</p>
      <p className="text-sm">Add an action to get started</p>
    </div>
  );
}
