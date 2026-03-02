/**
 * Collapsible section wrapper for annotation guideline content.
 */

"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface GuidelineSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function GuidelineSection({
  title,
  children,
  defaultOpen = false,
}: GuidelineSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full p-3 rounded-lg bg-surface-canvas hover:bg-surface-raised border border-border-subtle transition-colors text-left">
          <span className="font-medium text-text-primary">{title}</span>
          <ChevronRight
            className={`h-4 w-4 text-text-muted transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-4 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
