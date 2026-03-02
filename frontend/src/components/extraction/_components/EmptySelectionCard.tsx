"use client";

import { MousePointer } from "lucide-react";
import { Card } from "@/components/ui/card";

interface EmptySelectionCardProps {
  className?: string;
}

export function EmptySelectionCard({ className }: EmptySelectionCardProps) {
  return (
    <Card className={`p-6 bg-surface-raised/60 ${className}`}>
      <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted">
        <MousePointer className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-sm">Select an element to edit its properties</p>
        <p className="text-xs mt-2 opacity-60">
          Use the Select tool and click on an element
        </p>
        <p className="text-xs mt-1 opacity-60">
          Hold Shift to select multiple elements
        </p>
      </div>
    </Card>
  );
}
