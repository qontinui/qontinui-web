"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConflictNavigatorProps {
  selectedIndex: number;
  totalConflicts: number;
  onNavigate: (index: number) => void;
}

export function ConflictNavigator({
  selectedIndex,
  totalConflicts,
  onNavigate,
}: ConflictNavigatorProps) {
  if (totalConflicts <= 1) return null;

  return (
    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onNavigate(Math.max(0, selectedIndex - 1))}
        disabled={selectedIndex === 0}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Previous
      </Button>
      <span className="text-sm font-medium">
        Conflict {selectedIndex + 1} of {totalConflicts}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onNavigate(Math.min(totalConflicts - 1, selectedIndex + 1))
        }
        disabled={selectedIndex === totalConflicts - 1}
      >
        Next
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
