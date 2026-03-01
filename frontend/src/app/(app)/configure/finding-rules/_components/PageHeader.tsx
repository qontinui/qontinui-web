"use client";

import { Settings2, RotateCcw, RefreshCw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  onResetClick: () => void;
  onRefreshClick: () => void;
  onAddClick: () => void;
  isAddDisabled: boolean;
}

export function PageHeader({
  onResetClick,
  onRefreshClick,
  onAddClick,
  isAddDisabled,
}: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <Settings2 className="w-5 h-5 text-orange-400" />
        <h1 className="text-lg font-semibold text-foreground">
          Finding Categories
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetClick}
          className="text-muted-foreground hover:text-white"
          title="Reset to defaults"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefreshClick}
          className="text-muted-foreground hover:text-white"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
        <Button
          onClick={onAddClick}
          disabled={isAddDisabled}
          className="bg-primary hover:bg-primary/90 text-black font-semibold"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Category
        </Button>
      </div>
    </header>
  );
}
