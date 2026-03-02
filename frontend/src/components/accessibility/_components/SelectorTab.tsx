"use client";

import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccessibilitySelectorBuilder } from "../AccessibilitySelectorBuilder";
import type {
  AccessibilityNode,
  AccessibilitySelector,
} from "@qontinui/schemas/accessibility";

interface SelectorTabProps {
  currentSelector: AccessibilitySelector;
  onSelectorChange: (selector: AccessibilitySelector) => void;
  onTestSelector: () => void;
  matchCount: number;
  selectedNode: AccessibilityNode | null;
  showUseButton: boolean;
  onUseSelector: () => void;
}

export function SelectorTab({
  currentSelector,
  onSelectorChange,
  onTestSelector,
  matchCount,
  selectedNode,
  showUseButton,
  onUseSelector,
}: SelectorTabProps) {
  return (
    <div className="space-y-4">
      <AccessibilitySelectorBuilder
        selector={currentSelector}
        onChange={onSelectorChange}
        onTest={onTestSelector}
        matchCount={matchCount}
        selectedNode={selectedNode}
      />

      {selectedNode && showUseButton && (
        <Button onClick={onUseSelector} className="w-full" variant="default">
          <Crosshair className="h-4 w-4 mr-2" />
          Use This Selector
        </Button>
      )}
    </div>
  );
}
