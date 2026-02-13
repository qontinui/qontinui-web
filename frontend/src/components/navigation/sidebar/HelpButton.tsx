"use client";

import { useCallback } from "react";
import { BookOpen } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTutorialStore } from "@/stores/tutorial-store";
import { getTutorialById } from "@/components/tutorial/data";

export interface HelpButtonProps {
  isCollapsed: boolean;
}

export function HelpButton({ isCollapsed }: HelpButtonProps) {
  const openTutorial = useTutorialStore((s) => s.openTutorial);

  const handleStartTutorial = useCallback(() => {
    const tutorial = getTutorialById("getting-started-web");
    if (tutorial) {
      openTutorial(tutorial, "contextual");
    }
  }, [openTutorial]);

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleStartTutorial}
            data-tutorial-id="sidebar-help"
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <BookOpen className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Help &amp; Tutorials</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={handleStartTutorial}
      data-tutorial-id="sidebar-help"
      className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      <BookOpen className="size-4" />
      <span className="text-sm">Help &amp; Tutorials</span>
    </button>
  );
}
