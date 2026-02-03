"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Loader2, Clock, DollarSign, AlertCircle, Cpu } from "lucide-react";
import {
  createTrainingJob,
  getTrainingEstimate,
  type TrainingConfig,
  type TrainingJobModelType,
  type TrainingEstimate,
} from "@/lib/api/training";

interface TrainingJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  annotationSetId?: string;
  annotationCount?: number;
  onSuccess?: (jobId: string) => void;
}

const MODEL_TYPE_OPTIONS: {
  value: TrainingJobModelType;
  label: string;
  description: string;
}[] = [
  {
    value: "detection",
    label: "Object Detection",
    description: "Detect and locate objects with bounding boxes",
  },
  {
    value: "classification",
    label: "Classification",
    description: "Classify images into categories",
  },
  {
    value: "segmentation",
    label: "Segmentation",
    description: "Pixel-level object segmentation",
  },
];

const EPOCH_PRESETS = [10, 25, 50, 100];
const BATCH_SIZE_OPTIONS = [8, 16, 32];

export function TrainingJobDialog({
  open,
  onOpenChange,
  projectId,
  annotationSetId,
  annotationCount = 100,
  onSuccess,
}: TrainingJobDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<TrainingEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelType, setModelType] = useState<TrainingJobModelType>("detection");
  const [epochs, setEpochs] = useState(50);
  const [batchSize, setBatchSize] = useState(16);
  const [learningRate, setLearningRate] = useState(0.001);
  const [augmentation, setAugmentation] = useState(true);
  const [trainSplit, setTrainSplit] = useState(0.8);

  const config: Partial<TrainingConfig> = {
    model_type: modelType,
    epochs,
    batch_size: batchSize,
    learning_rate: learningRate,
    augmentation,
    train_split: trainSplit,
    validation_split: 1 - trainSplit,
  };

  // Fetch estimate when config changes
  const fetchEstimate = useCallback(async () => {
    setIsEstimating(true);
    try {
      const est = await getTrainingEstimate(config, annotationCount);
      setEstimate(est);
    } catch (err) {
      console.error("Failed to get estimate:", err);
      setEstimate(null);
    } finally {
      setIsEstimating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- config object is derived from the individual deps listed; using config directly would cause infinite loops
  }, [modelType, epochs, batchSize, augmentation, annotationCount]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(fetchEstimate, 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open, fetchEstimate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const job = await createTrainingJob({
        project_id: projectId,
        annotation_set_id: annotationSetId,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        config,
      });

      onSuccess?.(job.id);
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create training job"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      // Reset form
      setName("");
      setDescription("");
      setModelType("detection");
      setEpochs(50);
      setBatchSize(16);
      setLearningRate(0.001);
      setAugmentation(true);
      setTrainSplit(0.8);
      setError(null);
      setEstimate(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-surface-overlay border-border-subtle text-white sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-brand-primary" />
            Start Training Job
          </DialogTitle>
          <DialogDescription className="text-text-muted">
            Configure and start a new ML training job using your annotations.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name and Description */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="job-name">Job Name (optional)</Label>
              <Input
                id="job-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My training job"
                className="bg-surface-canvas border-border-default"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="job-description">Description (optional)</Label>
              <Input
                id="job-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Training for UI element detection..."
                className="bg-surface-canvas border-border-default"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Model Type Selection */}
          <div className="space-y-2">
            <Label>Model Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setModelType(option.value)}
                  disabled={isLoading}
                  className={`p-3 rounded-md border text-left transition-colors ${
                    modelType === option.value
                      ? "border-brand-primary bg-brand-primary/10"
                      : "border-border-default hover:border-border-strong"
                  }`}
                >
                  <div className="font-medium text-sm">{option.label}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {option.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Training Parameters */}
          <div className="space-y-4">
            {/* Epochs */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Epochs</Label>
                <span className="text-sm text-text-muted">{epochs}</span>
              </div>
              <div className="flex gap-2">
                {EPOCH_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setEpochs(preset)}
                    disabled={isLoading}
                    className={`px-3 py-1 rounded text-sm ${
                      epochs === preset
                        ? "bg-brand-primary text-white"
                        : "bg-surface-raised hover:bg-surface-highlight"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Batch Size */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Batch Size</Label>
                <span className="text-sm text-text-muted">{batchSize}</span>
              </div>
              <div className="flex gap-2">
                {BATCH_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setBatchSize(size)}
                    disabled={isLoading}
                    className={`px-3 py-1 rounded text-sm ${
                      batchSize === size
                        ? "bg-brand-primary text-white"
                        : "bg-surface-raised hover:bg-surface-highlight"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Learning Rate */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Learning Rate</Label>
                <span className="text-sm text-text-muted">{learningRate}</span>
              </div>
              <Slider
                value={[learningRate * 1000]}
                onValueChange={(values) => {
                  const v = values[0];
                  if (v !== undefined) setLearningRate(v / 1000);
                }}
                min={0.1}
                max={10}
                step={0.1}
                disabled={isLoading}
                className="w-full"
              />
            </div>

            {/* Train/Val Split */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Train/Validation Split</Label>
                <span className="text-sm text-text-muted">
                  {Math.round(trainSplit * 100)}% /{" "}
                  {Math.round((1 - trainSplit) * 100)}%
                </span>
              </div>
              <Slider
                value={[trainSplit * 100]}
                onValueChange={(values) => {
                  const v = values[0];
                  if (v !== undefined) setTrainSplit(v / 100);
                }}
                min={50}
                max={95}
                step={5}
                disabled={isLoading}
                className="w-full"
              />
            </div>

            {/* Augmentation Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="augmentation">Data Augmentation</Label>
                <p className="text-xs text-text-muted">
                  Apply random transforms to increase training data variety
                </p>
              </div>
              <Switch
                id="augmentation"
                checked={augmentation}
                onCheckedChange={setAugmentation}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Estimate Display */}
          <div className="p-4 bg-surface-raised rounded-lg space-y-2">
            <div className="text-sm font-medium">Estimate</div>
            {isEstimating ? (
              <div className="flex items-center gap-2 text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                Calculating...
              </div>
            ) : estimate ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-text-muted" />
                  <span>~{estimate.estimated_time_minutes} minutes</span>
                </div>
                {estimate.estimated_cost_usd && (
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="w-4 h-4 text-text-muted" />
                    <span>
                      ~${estimate.estimated_cost_usd.toFixed(2)} (GPU:{" "}
                      {estimate.gpu_type})
                    </span>
                  </div>
                )}
                {estimate.notes && (
                  <div className="flex items-start gap-2 text-xs text-text-muted">
                    <AlertCircle className="w-3 h-3 mt-0.5" />
                    <span>{estimate.notes}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-text-muted">Unable to estimate</div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-md">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
              className="border-border-default bg-transparent hover:bg-surface-raised"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Training Job"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
