"use client";

import { BookOpen, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnnotationGuidelinesDialog } from "../AnnotationGuidelinesDialog";

interface HelpActionsProps {
  onShowShortcuts: () => void;
}

export function HelpActions({ onShowShortcuts }: HelpActionsProps) {
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <AnnotationGuidelinesDialog
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="text-text-muted hover:text-[#9B59B6]"
              >
                <BookOpen className="h-4 w-4" />
              </Button>
            }
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Annotation Guidelines</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowShortcuts}
            className="text-text-muted hover:text-[#9B59B6]"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Keyboard Shortcuts (?)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
