"use client";

import { MousePointer2, Square, Trash2, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useExtractionAnnotationStore,
  type AnnotationTool,
} from "@/stores/extraction-annotation-store";

const tools: { id: AnnotationTool; icon: React.ReactNode; label: string }[] = [
  {
    id: "select",
    icon: <MousePointer2 className="h-4 w-4" />,
    label: "Select (S)",
  },
  {
    id: "draw",
    icon: <Square className="h-4 w-4" />,
    label: "Draw Box (D)",
  },
  {
    id: "delete",
    icon: <Trash2 className="h-4 w-4" />,
    label: "Delete (X)",
  },
  { id: "pan", icon: <Move className="h-4 w-4" />, label: "Pan (P)" },
];

export function ToolSelector() {
  const { activeTool, setActiveTool } = useExtractionAnnotationStore();

  return (
    <div className="flex items-center gap-1">
      {tools.map((tool) => (
        <Tooltip key={tool.id}>
          <TooltipTrigger asChild>
            <Button
              variant={activeTool === tool.id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTool(tool.id)}
              className={
                activeTool === tool.id
                  ? "bg-[#9B59B6]/20 text-[#9B59B6] hover:bg-[#9B59B6]/30"
                  : ""
              }
            >
              {tool.icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{tool.label}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
