"use client";

import { List } from "lucide-react";
import { Action } from "@/lib/action-schema/action-types";
import { ActionProperties } from "@/components/action-properties";

interface PropertiesPanelProps {
  selectedAction: Action | null;
  onUpdateAction: (action: Action) => void;
}

export function PropertiesPanel({
  selectedAction,
  onUpdateAction,
}: PropertiesPanelProps) {
  return (
    <div
      className="w-96 border-l border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto flex-shrink-0"
      data-tutorial-id="graph-properties"
    >
      {selectedAction ? (
        <ActionProperties
          action={
            selectedAction as Parameters<typeof ActionProperties>[0]["action"]
          }
          onUpdateAction={(action) =>
            onUpdateAction(action as unknown as Action)
          }
        />
      ) : (
        <div className="flex items-center justify-center h-full text-text-muted">
          <div className="text-center">
            <List className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Select a node to edit</p>
            <p className="text-xs mt-1">Click on a node in the canvas</p>
          </div>
        </div>
      )}
    </div>
  );
}
