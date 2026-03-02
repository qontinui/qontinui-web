"use client";

import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "../state-image-modal-types";

interface StateDetailsPanelHeaderProps {
  viewMode: ViewMode;
  title: string;
  typeBadge: string;
  onBackToState: () => void;
}

export function StateDetailsPanelHeader({
  viewMode,
  title,
  typeBadge,
  onBackToState,
}: StateDetailsPanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 p-3 border-b shrink-0">
      {viewMode === "element" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onBackToState}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
      <ImageIcon className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium text-sm truncate">{title}</span>
      <Badge variant="outline" className="text-xs shrink-0">
        {typeBadge}
      </Badge>
    </div>
  );
}
