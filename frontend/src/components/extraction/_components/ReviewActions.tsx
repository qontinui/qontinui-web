"use client";

import { CheckCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

export function ReviewActions() {
  const { bulkApprove, bulkReject } = useExtractionAnnotationStore();

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={bulkApprove}
            className="text-green-600 hover:text-green-600"
          >
            <CheckCheck className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Approve Selected</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => bulkReject()}
            className="text-red-600 hover:text-red-600"
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Reject Selected</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
