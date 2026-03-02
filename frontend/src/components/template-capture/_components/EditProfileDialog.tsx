import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type {
  ApplicationProfile,
  DetectionStrategyType,
} from "@/services/template-capture-service";
import { StrategyPicker } from "./StrategyPicker";

interface EditProfileDialogProps {
  profile: ApplicationProfile | null;
  onClose: () => void;
  formStrategies: DetectionStrategyType[];
  onToggleStrategy: (strategy: DetectionStrategyType) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function EditProfileDialog({
  profile,
  onClose,
  formStrategies,
  onToggleStrategy,
  onSubmit,
  submitting,
}: EditProfileDialogProps) {
  return (
    <Dialog open={!!profile} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Profile: {profile?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Preferred Detection Strategies</Label>
            <StrategyPicker
              selected={formStrategies}
              onToggle={onToggleStrategy}
            />
          </div>
          {profile?.tuning_metrics && (
            <div className="space-y-2">
              <Label>Tuning Metrics</Label>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  Samples analyzed: {profile.tuning_metrics.samples_analyzed}
                </p>
                <p>
                  Avg accuracy:{" "}
                  {Math.round(
                    profile.tuning_metrics.avg_boundary_accuracy * 100
                  )}
                  %
                </p>
                <p>
                  Edge thresholds:{" "}
                  {profile.tuning_metrics.optimal_edge_thresholds.join(" - ")}
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
