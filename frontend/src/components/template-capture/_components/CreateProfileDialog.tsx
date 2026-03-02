import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { DetectionStrategyType } from "@/services/template-capture-service";
import { StrategyPicker } from "./StrategyPicker";

interface CreateProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formName: string;
  onFormNameChange: (name: string) => void;
  formStrategies: DetectionStrategyType[];
  onToggleStrategy: (strategy: DetectionStrategyType) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function CreateProfileDialog({
  open,
  onOpenChange,
  formName,
  onFormNameChange,
  formStrategies,
  onToggleStrategy,
  onSubmit,
  submitting,
}: CreateProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Application Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Application Name</Label>
            <Input
              id="name"
              placeholder="e.g., Civilization 6"
              value={formName}
              onChange={(e) => onFormNameChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Preferred Detection Strategies</Label>
            <StrategyPicker
              selected={formStrategies}
              onToggle={onToggleStrategy}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use all strategies
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!formName.trim() || submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
