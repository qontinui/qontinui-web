"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { UnifiedProcessLibrary } from "@/components/unified-process-library";
import type { Workflow } from "@/lib/action-schema/action-types";

interface LeftPanelProps {
  selectedItem: Workflow | null;
  onSelectItem: (item: Workflow) => void;
  onDeleteItem: (item: Workflow) => void;
  onUpdateWorkflow: (workflow: Workflow) => void;
  onCreateSequential: (category?: string) => void;
  onConvertItem: (item: Workflow) => void;
}

export function LeftPanel({
  selectedItem,
  onSelectItem,
  onDeleteItem,
  onUpdateWorkflow,
  onCreateSequential,
  onConvertItem,
}: LeftPanelProps) {
  return (
    <div className="flex-[2] min-w-[300px] max-w-[600px] border-r border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto">
      <div className="space-y-4">
        <Button
          onClick={() => onCreateSequential()}
          className="w-full bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Workflow
        </Button>

        <UnifiedProcessLibrary
          selectedItem={selectedItem}
          onSelectItem={onSelectItem}
          onDeleteItem={onDeleteItem}
          onUpdateWorkflow={onUpdateWorkflow}
          onCreateSequential={onCreateSequential}
          onConvertItem={onConvertItem}
        />
      </div>
    </div>
  );
}
