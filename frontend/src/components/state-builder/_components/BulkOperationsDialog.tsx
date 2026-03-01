"use client";

import React from "react";
import { Copy, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BulkOperationPayload } from "../types";

export interface BulkOperationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onBulkOperation: (operation: BulkOperationPayload) => void;
  selectedStateIds: Set<string>;
}

export function BulkOperationsDialog({
  open,
  onOpenChange,
  selectedCount,
  onBulkOperation,
  selectedStateIds,
}: BulkOperationsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Operations</DialogTitle>
          <DialogDescription>
            {selectedCount} state(s) selected
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() =>
              onBulkOperation({
                stateIds: Array.from(selectedStateIds),
                operation: "duplicate",
              })
            }
          >
            <Copy className="mr-2 h-4 w-4" />
            Duplicate All
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() =>
              onBulkOperation({
                stateIds: Array.from(selectedStateIds),
                operation: "export",
              })
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Export All
          </Button>
          <Button
            variant="destructive"
            className="w-full justify-start"
            onClick={() =>
              onBulkOperation({
                stateIds: Array.from(selectedStateIds),
                operation: "delete",
              })
            }
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete All
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
