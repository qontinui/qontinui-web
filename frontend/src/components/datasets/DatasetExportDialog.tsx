"use client";

/**
 * Dataset Export Dialog
 *
 * Modal for exporting training datasets to various ML formats:
 * - COCO (Common Objects in Context)
 * - YOLO (You Only Look Once)
 * - Pascal VOC
 * - CSV
 * - JSONL
 *
 * NOTE: Images are NOT included in exports to avoid AWS transfer costs.
 * Users should use the qontinui-runner to package local images with
 * the exported annotations.
 */

import { useState, useEffect } from "react";
import { datasetService } from "@/services/dataset-service";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  FileJson,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  SplitSquareHorizontal,
  Info,
} from "lucide-react";
import type { ExportFormat, DatasetExportJob } from "@/types/dataset";

interface DatasetExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  datasetName: string;
}

type ExportStep = "configure" | "exporting" | "complete" | "error";

const FORMAT_OPTIONS: {
  value: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "coco",
    label: "COCO",
    description: "Standard format for object detection (JSON)",
    icon: <FileJson className="h-4 w-4" />,
  },
  {
    value: "yolo",
    label: "YOLO",
    description: "Ultralytics YOLO format (TXT per image)",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    value: "pascal_voc",
    label: "Pascal VOC",
    description: "XML annotations per image",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    value: "csv",
    label: "CSV",
    description: "Simple spreadsheet format",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    value: "jsonl",
    label: "JSONL",
    description: "JSON Lines format (one JSON per line)",
    icon: <FileJson className="h-4 w-4" />,
  },
];

export function DatasetExportDialog({
  open,
  onOpenChange,
  datasetId,
  datasetName,
}: DatasetExportDialogProps) {
  const [step, setStep] = useState<ExportStep>("configure");
  const [format, setFormat] = useState<ExportFormat>("yolo");
  const [useSplit, setUseSplit] = useState(false);
  const [trainPercent, setTrainPercent] = useState(70);
  const [valPercent, setValPercent] = useState(20);
  const [testPercent, setTestPercent] = useState(10);
  const [randomSeed, setRandomSeed] = useState<number | undefined>(42);
  const [exportJob, setExportJob] = useState<DatasetExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for export job status
  useEffect(() => {
    if (
      !exportJob ||
      exportJob.status === "completed" ||
      exportJob.status === "failed"
    ) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const updatedJob = await datasetService.getExportJob(
          datasetId,
          exportJob.id
        );
        setExportJob(updatedJob);

        if (updatedJob.status === "completed") {
          setStep("complete");
        } else if (updatedJob.status === "failed") {
          setError(updatedJob.error || "Export failed");
          setStep("error");
        }
      } catch (err) {
        console.error("Error polling export job:", err);
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [exportJob, datasetId]);

  const handleExport = async () => {
    setStep("exporting");
    setError(null);

    try {
      const job = await datasetService.startExport(datasetId, {
        format,
        include_images: false, // Images are never included - users package locally via runner
        split: useSplit
          ? {
              train_percent: trainPercent / 100,
              val_percent: valPercent / 100,
              test_percent: testPercent / 100,
              random_seed: randomSeed,
            }
          : undefined,
      });

      setExportJob(job);

      if (job.status === "completed") {
        setStep("complete");
      } else if (job.status === "failed") {
        setError(job.error || "Export failed");
        setStep("error");
      }
    } catch (err) {
      console.error("Export error:", err);
      setError(err instanceof Error ? err.message : "Export failed");
      setStep("error");
    }
  };

  const handleDownload = () => {
    if (exportJob?.download_url) {
      window.open(exportJob.download_url, "_blank");
      toast.success("Download started");
    }
  };

  const handleClose = () => {
    setStep("configure");
    setFormat("yolo");
    setUseSplit(false);
    setTrainPercent(70);
    setValPercent(20);
    setTestPercent(10);
    setExportJob(null);
    setError(null);
    onOpenChange(false);
  };

  const handleReset = () => {
    setStep("configure");
    setExportJob(null);
    setError(null);
  };

  // Validate split percentages
  const splitTotal = trainPercent + valPercent + testPercent;
  const splitValid = Math.abs(splitTotal - 100) < 0.01;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" data-ui-id="dialog-dataset-export">
        <DialogHeader>
          <DialogTitle>Export Dataset</DialogTitle>
          <DialogDescription>
            Export &quot;{datasetName}&quot; to a format suitable for ML
            training.
          </DialogDescription>
        </DialogHeader>

        {/* Step: Configure */}
        {step === "configure" && (
          <div className="space-y-6">
            {/* Format Selection */}
            <div className="space-y-2">
              <Label>Export Format</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as ExportFormat)}
              >
                <SelectTrigger data-ui-id="dialog-dataset-export-format-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        {opt.icon}
                        <div>
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-muted-foreground ml-2 text-xs">
                            {opt.description}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Info about images */}
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Info className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p>
                  Export contains <strong>annotations only</strong>. Images are
                  stored locally on your machine by the Qontinui Runner.
                </p>
                <p className="mt-1">
                  Use the Runner to package your local images with this export.
                </p>
              </div>
            </div>

            {/* Train/Val/Test Split */}
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="use-split"
                  checked={useSplit}
                  onCheckedChange={(checked) => setUseSplit(checked === true)}
                  data-ui-id="dialog-dataset-export-split-checkbox"
                />
                <Label htmlFor="use-split" className="cursor-pointer">
                  <div className="flex items-center gap-2">
                    <SplitSquareHorizontal className="h-4 w-4" />
                    Split into train/val/test sets
                  </div>
                </Label>
              </div>

              {useSplit && (
                <div className="pl-6 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="train-percent" className="text-xs">
                        Train %
                      </Label>
                      <Input
                        id="train-percent"
                        type="number"
                        min={0}
                        max={100}
                        value={trainPercent}
                        onChange={(e) =>
                          setTrainPercent(Number(e.target.value))
                        }
                        data-ui-id="dialog-dataset-export-train-percent-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="val-percent" className="text-xs">
                        Val %
                      </Label>
                      <Input
                        id="val-percent"
                        type="number"
                        min={0}
                        max={100}
                        value={valPercent}
                        onChange={(e) => setValPercent(Number(e.target.value))}
                        data-ui-id="dialog-dataset-export-val-percent-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="test-percent" className="text-xs">
                        Test %
                      </Label>
                      <Input
                        id="test-percent"
                        type="number"
                        min={0}
                        max={100}
                        value={testPercent}
                        onChange={(e) => setTestPercent(Number(e.target.value))}
                        data-ui-id="dialog-dataset-export-test-percent-input"
                      />
                    </div>
                  </div>

                  {!splitValid && (
                    <p className="text-xs text-destructive">
                      Split percentages must sum to 100% (currently {splitTotal}
                      %)
                    </p>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="random-seed" className="text-xs">
                      Random Seed (optional)
                    </Label>
                    <Input
                      id="random-seed"
                      type="number"
                      placeholder="42"
                      value={randomSeed ?? ""}
                      onChange={(e) =>
                        setRandomSeed(
                          e.target.value ? Number(e.target.value) : undefined
                        )
                      }
                      className="w-32"
                      data-ui-id="dialog-dataset-export-seed-input"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use a seed for reproducible splits
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step: Exporting */}
        {step === "exporting" && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-12 w-12 text-primary animate-spin mb-4" />
            <p className="font-medium mb-4">Exporting dataset...</p>
            <Progress value={exportJob?.progress || 0} className="w-full" />
            <p className="text-sm text-muted-foreground mt-2">
              {exportJob?.progress || 0}%
            </p>
          </div>
        )}

        {/* Step: Complete */}
        {step === "complete" && exportJob && (
          <div className="py-4">
            <div className="flex items-center justify-center mb-6">
              <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-center mb-4">
              Export Complete!
            </h3>
            <div className="text-center mb-6">
              <p className="text-muted-foreground">
                Your dataset has been exported in {format.toUpperCase()} format.
              </p>
            </div>
            <div className="flex justify-center">
              <Button
                onClick={handleDownload}
                size="lg"
                data-ui-id="dialog-dataset-export-download-btn"
              >
                <Download className="mr-2 h-5 w-5" />
                Download Export
              </Button>
            </div>
          </div>
        )}

        {/* Step: Error */}
        {step === "error" && (
          <div className="py-4">
            <div className="flex items-center justify-center mb-6">
              <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-center mb-4">
              Export Failed
            </h3>
            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-300">
                  {error}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "configure" && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                data-ui-id="dialog-dataset-export-cancel-btn"
              >
                Cancel
              </Button>
              <Button
                onClick={handleExport}
                disabled={useSplit && !splitValid}
                data-ui-id="dialog-dataset-export-confirm-btn"
              >
                <Download className="mr-2 h-4 w-4" />
                Export Dataset
              </Button>
            </>
          )}

          {step === "exporting" && (
            <Button variant="outline" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </Button>
          )}

          {step === "complete" && (
            <Button
              onClick={handleClose}
              data-ui-id="dialog-dataset-export-done-btn"
            >
              Done
            </Button>
          )}

          {step === "error" && (
            <>
              <Button
                variant="outline"
                onClick={handleReset}
                data-ui-id="dialog-dataset-export-retry-btn"
              >
                Try Again
              </Button>
              <Button
                onClick={handleClose}
                data-ui-id="dialog-dataset-export-close-btn"
              >
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
