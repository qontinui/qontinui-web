import React from "react";
import { CheckCircle2, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TutorialStatus } from "../_types/tutorial-menu";

export function StatusBadge({ status }: { status: TutorialStatus }) {
  if (status === "completed") {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/10 text-green-700 flex items-center gap-1"
      >
        <CheckCircle2 className="h-3 w-3" />
        Completed
      </Badge>
    );
  }

  if (status === "in-progress") {
    return (
      <Badge
        variant="secondary"
        className="bg-blue-500/10 text-blue-700 flex items-center gap-1"
      >
        <PlayCircle className="h-3 w-3" />
        In Progress
      </Badge>
    );
  }

  return null;
}
