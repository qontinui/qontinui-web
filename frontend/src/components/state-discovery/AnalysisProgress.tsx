/**
 * Analysis Progress Component
 * Shows real-time progress during State Discovery analysis
 */

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Upload,
  Search,
  Layers,
  Package,
  CheckCircle,
  Circle,
  Loader2,
} from "lucide-react";

interface AnalysisProgressProps {
  progress: number;
  onCancel: () => void;
}

interface Stage {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  percentage: number;
}

const AnalysisProgress: React.FC<AnalysisProgressProps> = ({
  progress,
  onCancel,
}) => {
  const stages: Stage[] = [
    {
      id: "uploading",
      name: "Uploading",
      icon: Upload,
      percentage: 0,
    },
    {
      id: "pixel_analysis",
      name: "Analyzing Pixels",
      icon: Search,
      percentage: 30,
    },
    {
      id: "region_extraction",
      name: "Extracting Regions",
      icon: Layers,
      percentage: 60,
    },
    {
      id: "state_assembly",
      name: "Building States",
      icon: Package,
      percentage: 90,
    },
  ];

  const currentStageIndex = stages.findIndex((s) => progress <= s.percentage);
  const currentStage =
    stages[
      Math.max(
        0,
        currentStageIndex !== -1 ? currentStageIndex : stages.length - 1
      )
    ];

  const getStageStatus = (stage: Stage) => {
    if (progress >= stage.percentage + 30) return "complete";
    if (progress >= stage.percentage && progress < stage.percentage + 30)
      return "active";
    return "pending";
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Analyzing Screenshots</DialogTitle>
          <DialogDescription>
            Discovering StateImages and analyzing state structure...
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Stage indicators */}
          <div className="flex justify-between">
            {stages.map((stage, index) => {
              const status = getStageStatus(stage);
              const Icon = stage.icon;

              return (
                <div
                  key={stage.id}
                  className={cn(
                    "flex flex-col items-center space-y-2",
                    status === "complete" && "text-green-600",
                    status === "active" && "text-blue-600",
                    status === "pending" && "text-text-muted"
                  )}
                >
                  <div className="relative">
                    {status === "complete" ? (
                      <CheckCircle className="h-8 w-8" />
                    ) : status === "active" ? (
                      <div className="relative">
                        <Circle className="h-8 w-8" />
                        <Loader2 className="h-8 w-8 absolute top-0 left-0 animate-spin" />
                      </div>
                    ) : (
                      <Icon className="h-8 w-8" />
                    )}
                  </div>
                  <span className="text-xs font-medium text-center">
                    {stage.name}
                  </span>

                  {/* Connection line */}
                  {index < stages.length - 1 && (
                    <div
                      className={cn(
                        "absolute left-full top-4 w-full h-0.5",
                        status === "complete"
                          ? "bg-green-600"
                          : "bg-surface-raised"
                      )}
                      style={{
                        width: "calc(100% - 2rem)",
                        marginLeft: "1rem",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-sm text-text-muted">
              <span>{currentStage?.name || "Processing"}</span>
              <span>{progress}%</span>
            </div>
          </div>

          {/* Status message */}
          <div className="bg-surface-canvas rounded-lg p-3">
            <p className="text-sm text-text-muted">
              {progress < 30 &&
                "Creating pixel stability map across screenshots..."}
              {progress >= 30 &&
                progress < 60 &&
                "Identifying stable regions and extracting StateImages..."}
              {progress >= 60 &&
                progress < 90 &&
                "Grouping StateImages based on co-occurrence patterns..."}
              {progress >= 90 &&
                "Finalizing state structure and calculating statistics..."}
            </p>
          </div>

          {/* Cancel button */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={onCancel}>
              Cancel Analysis
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AnalysisProgress;
