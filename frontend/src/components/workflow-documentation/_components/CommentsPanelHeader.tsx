import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Search, Download } from "lucide-react";
import { CommentViewMode } from "../types";

interface CommentsPanelHeaderProps {
  commentsCount: number;
  searchQuery: string;
  viewMode: CommentViewMode;
  selectedActionId?: string;
  onSearchChange: (query: string) => void;
  onViewModeChange: (mode: CommentViewMode) => void;
  onExport: () => void;
}

export function CommentsPanelHeader({
  commentsCount,
  searchQuery,
  viewMode,
  selectedActionId,
  onSearchChange,
  onViewModeChange,
  onExport,
}: CommentsPanelHeaderProps) {
  return (
    <div className="p-4 border-b space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-5" />
          <h2 className="text-lg font-semibold">Action Comments</h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={commentsCount === 0}
          >
            <Download className="size-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search comments..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={viewMode === "selected" ? "default" : "outline"}
          size="sm"
          onClick={() => onViewModeChange("selected")}
          disabled={!selectedActionId}
        >
          Selected Action
        </Button>
        <Button
          variant={viewMode === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => onViewModeChange("all")}
        >
          All Comments ({commentsCount})
        </Button>
      </div>
    </div>
  );
}
