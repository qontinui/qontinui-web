"use client";

import React from "react";
import { Navigation } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface GenerateFromStatesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GenerateFromStatesModal({
  isOpen,
  onClose,
}: GenerateFromStatesModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-400" />
            Generate from States
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Generate a workflow from stored application states. Select states to
            navigate between and the system will create setup and verification
            steps automatically.
          </p>

          <div className="p-8 flex items-center justify-center border border-dashed border-zinc-700 rounded-lg">
            <p className="text-sm text-zinc-500">
              State selection will be available once states are loaded from the
              runner.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
