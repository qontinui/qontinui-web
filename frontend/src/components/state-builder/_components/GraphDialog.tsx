"use client";

import React from "react";
import { GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface GraphDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transitionCount: number;
}

export function GraphDialog({
  open,
  onOpenChange,
  transitionCount,
}: GraphDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>State Relationship Graph</DialogTitle>
          <DialogDescription>
            Visual representation of state transitions
          </DialogDescription>
        </DialogHeader>
        <div className="h-[500px] flex items-center justify-center border rounded bg-muted">
          <div className="text-center text-muted-foreground">
            <GitBranch className="h-12 w-12 mx-auto mb-4" />
            <p>Graph visualization would appear here</p>
            <p className="text-xs mt-2">
              Showing {transitionCount} transition(s)
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
