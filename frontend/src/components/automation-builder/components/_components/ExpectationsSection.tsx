import React, { useState, useCallback } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { ExpectationsPanel } from "@/components/expectations/ExpectationsPanel";
import type { WorkflowExpectations } from "@/lib/expectations/types";
import type { LibraryItem } from "../../types";

interface ExpectationsSectionProps {
  item: LibraryItem;
  onUpdate: (item: LibraryItem) => void;
}

export function ExpectationsSection({
  item,
  onUpdate,
}: ExpectationsSectionProps) {
  const [expectationsOpen, setExpectationsOpen] = useState(false);

  const handleExpectationsChange = useCallback(
    (expectations: WorkflowExpectations) => {
      onUpdate({
        ...item,
        expectations,
        metadata: {
          ...item.metadata,
          updated: new Date().toISOString(),
        },
      });
    },
    [item, onUpdate]
  );

  return (
    <div className="mt-6 pt-6 border-t border-border-subtle">
      <Collapsible open={expectationsOpen} onOpenChange={setExpectationsOpen}>
        <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-surface-canvas/50 rounded-md px-2 transition-colors">
          <span className="text-sm font-medium text-text-muted">
            Workflow Expectations
          </span>
          <ChevronDown
            className={`h-4 w-4 text-text-muted transition-transform duration-200 ${
              expectationsOpen ? "rotate-180" : ""
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="bg-surface-canvas/30 border border-border-subtle rounded-lg overflow-hidden">
            <ExpectationsPanel
              expectations={item.expectations}
              onChange={handleExpectationsChange}
              availableCheckpoints={[]}
              availableStates={[]}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
