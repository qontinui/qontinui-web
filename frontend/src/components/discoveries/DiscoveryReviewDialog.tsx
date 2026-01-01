"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DiscoveryTypeBadge } from "./DiscoveryTypeBadge";
import type { Discovery } from "@/types/discoveries";
import { Check, X, Loader2 } from "lucide-react";

interface DiscoveryReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "accept" | "reject";
  discovery: Discovery;
  onSubmit: (notes?: string) => Promise<void>;
  isSubmitting?: boolean;
}

export function DiscoveryReviewDialog({
  open,
  onOpenChange,
  action,
  discovery,
  onSubmit,
  isSubmitting = false,
}: DiscoveryReviewDialogProps) {
  const [notes, setNotes] = useState("");

  const handleSubmit = async () => {
    await onSubmit(notes.trim() || undefined);
    setNotes("");
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setNotes("");
    }
    onOpenChange(isOpen);
  };

  const isAccepting = action === "accept";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[#1A1A1B] border-gray-800 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAccepting ? (
              <Check className="text-green-500" size={20} />
            ) : (
              <X className="text-red-500" size={20} />
            )}
            <span className="text-white">
              {isAccepting ? "Accept Discovery" : "Reject Discovery"}
            </span>
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            {isAccepting
              ? "This discovery will be marked as accepted and can be applied to your configuration."
              : "This discovery will be marked as rejected and will be hidden from the pending list."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Discovery summary */}
          <div className="bg-gray-900/50 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Type</span>
              <DiscoveryTypeBadge type={discovery.discovery_type} />
            </div>
            <div className="text-white font-medium">{discovery.title}</div>
            {discovery.description && (
              <div className="text-sm text-gray-400">
                {discovery.description}
              </div>
            )}
          </div>

          {/* Notes input */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-gray-300">
              Notes (optional)
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isAccepting
                  ? "Add any notes about why you're accepting this discovery..."
                  : "Add any notes about why you're rejecting this discovery..."
              }
              className="bg-gray-900/50 border-gray-700 text-white placeholder:text-gray-500 min-h-[100px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-white hover:bg-gray-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={
              isAccepting
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
            }
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isAccepting ? "Accepting..." : "Rejecting..."}
              </>
            ) : (
              <>
                {isAccepting ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                {isAccepting ? "Accept" : "Reject"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
