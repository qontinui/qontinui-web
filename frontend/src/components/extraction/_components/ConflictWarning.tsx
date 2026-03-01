"use client";

import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

export function ConflictWarning() {
  const { conflict, resolveConflict } = useExtractionAnnotationStore();

  if (!conflict.hasConflict) return null;

  return (
    <>
      <Separator orientation="vertical" className="h-6 mx-2" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="destructive" size="sm" className="animate-pulse">
            <CloudOff className="h-4 w-4 mr-1" />
            Conflict
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => resolveConflict("keep_local")}>
            Keep Local Changes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => resolveConflict("keep_remote")}>
            Use Remote Version
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => resolveConflict("merge")}>
            Merge Both
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
