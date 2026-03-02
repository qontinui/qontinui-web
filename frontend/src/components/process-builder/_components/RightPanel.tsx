"use client";

import { ActionProperties } from "@/components/action-properties";
import type { Action as ActionPropertiesAction } from "@/components/action-properties/types";
import type { Workflow, Action } from "@/lib/action-schema/action-types";

interface RightPanelProps {
  selectedProcess: Workflow | null;
  selectedAction: Action | null;
  onUpdateProcess: (updated: Workflow) => void;
}

export function RightPanel({
  selectedProcess,
  selectedAction,
  onUpdateProcess,
}: RightPanelProps) {
  return (
    <div className="flex-[2] min-w-[300px] max-w-[600px] border-l border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto">
      <ActionProperties
        action={selectedAction as ActionPropertiesAction | null}
        onUpdateAction={(updated: ActionPropertiesAction) => {
          if (selectedProcess && selectedAction) {
            const updatedProcess = {
              ...selectedProcess,
              actions: selectedProcess.actions.map((a) =>
                a.id === updated.id ? (updated as unknown as Action) : a
              ),
            };
            onUpdateProcess(updatedProcess);
            // useEffect will handle updating selectedAction
          }
        }}
      />
    </div>
  );
}
