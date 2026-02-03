/**
 * Training Data Export Dialog
 *
 * Dialog for exporting annotated elements as training data in various formats.
 * Supports multiple export destinations:
 * - Local download (browser)
 * - S3 bucket (requires backend)
 * - Local filesystem path (requires backend)
 */

"use client";

import { useState } from "react";
import {
  Download,
  FileJson,
  FileText,
  Table,
  Cloud,
  HardDrive,
  FolderOpen,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  exportTrainingData,
  downloadExport,
  getFormatInfo,
  type ExportFormat,
} from "@/lib/training-data-export";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import { toast } from "sonner";

type ExportDestination = "download" | "s3" | "local";

interface S3Config {
  bucket: string;
  prefix: string;
  region: string;
}

interface LocalPathConfig {
  path: string;
}

interface TrainingDataExportDialogProps {
  trigger?: React.ReactNode;
  projectName?: string;
}

export function TrainingDataExportDialog({
  trigger,
  projectName,
}: TrainingDataExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("coco");
  const [includeAllElements, setIncludeAllElements] = useState(false);
  const [destination, setDestination] = useState<ExportDestination>("download");
  const [s3Config, setS3Config] = useState<S3Config>({
    bucket: "",
    prefix: "training-data/",
    region: "us-east-1",
  });
  const [localPathConfig, setLocalPathConfig] = useState<LocalPathConfig>({
    path: "",
  });
  const [isExporting, setIsExporting] = useState(false);

  const { elements, screenshotWidth, screenshotHeight } =
    useExtractionAnnotationStore();

  const groundTruthCount = elements.filter((el) => el.isGroundTruth).length;
  const totalCount = elements.length;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = exportTrainingData(elements, {
        format,
        includeAllElements,
        screenshotWidth: screenshotWidth || 1920,
        screenshotHeight: screenshotHeight || 1080,
        projectName,
      });

      if (destination === "download") {
        // Local browser download
        downloadExport(result.data, result.filename, result.mimeType);

        // Download extra file if present (e.g., YOLO classes.txt)
        if (result.extra) {
          setTimeout(() => {
            downloadExport(
              result.extra!.data,
              result.extra!.filename,
              "text/plain"
            );
          }, 500);
        }

        toast.success(
          `Exported ${includeAllElements ? totalCount : groundTruthCount} elements`
        );
      } else if (destination === "s3") {
        // S3 upload - requires backend integration
        // TODO: Implement backend endpoint for S3 upload
        // await fetch("/api/v1/exports/s3", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify({
        //     data: result.data,
        //     filename: result.filename,
        //     bucket: s3Config.bucket,
        //     prefix: s3Config.prefix,
        //     region: s3Config.region,
        //     extra: result.extra,
        //   }),
        // });
        toast.info("S3 export requires backend integration (coming soon)");
        // For now, fall back to download
        downloadExport(result.data, result.filename, result.mimeType);
        if (result.extra) {
          setTimeout(() => {
            downloadExport(
              result.extra!.data,
              result.extra!.filename,
              "text/plain"
            );
          }, 500);
        }
        toast.success(
          `Downloaded ${includeAllElements ? totalCount : groundTruthCount} elements (S3 not yet available)`
        );
      } else if (destination === "local") {
        // Local filesystem path - requires backend integration
        // TODO: Implement backend endpoint for local save
        // await fetch("/api/v1/exports/local", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify({
        //     data: result.data,
        //     filename: result.filename,
        //     path: localPathConfig.path,
        //     extra: result.extra,
        //   }),
        // });
        toast.info(
          "Local path export requires backend integration (coming soon)"
        );
        // For now, fall back to download
        downloadExport(result.data, result.filename, result.mimeType);
        if (result.extra) {
          setTimeout(() => {
            downloadExport(
              result.extra!.data,
              result.extra!.filename,
              "text/plain"
            );
          }, 500);
        }
        toast.success(
          `Downloaded ${includeAllElements ? totalCount : groundTruthCount} elements (local path not yet available)`
        );
      }

      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const isDestinationConfigured = () => {
    if (destination === "download") return true;
    if (destination === "s3") return s3Config.bucket.trim() !== "";
    if (destination === "local") return localPathConfig.path.trim() !== "";
    return false;
  };

  const formatOptions: { value: ExportFormat; icon: React.ReactNode }[] = [
    { value: "coco", icon: <FileJson className="h-4 w-4" /> },
    { value: "yolo", icon: <FileText className="h-4 w-4" /> },
    { value: "csv", icon: <Table className="h-4 w-4" /> },
  ];

  const selectedFormatInfo = getFormatInfo(format);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            size="sm"
            className="border-[#9B59B6]/50 text-[#9B59B6] hover:bg-[#9B59B6]/10"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Training Data
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Training Data</DialogTitle>
          <DialogDescription>
            Export annotated elements for ML training. Ground truth elements are
            recommended for training.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Element counts */}
          <div className="flex gap-4 justify-center">
            <div className="text-center">
              <div className="text-2xl font-bold text-[#9B59B6]">
                {totalCount}
              </div>
              <div className="text-xs text-text-muted">Total Elements</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">
                {groundTruthCount}
              </div>
              <div className="text-xs text-text-muted">Ground Truth</div>
            </div>
          </div>

          {groundTruthCount === 0 && !includeAllElements && (
            <Alert className="bg-yellow-500/10 border-yellow-500/30">
              <AlertDescription className="text-yellow-600 dark:text-yellow-400 text-sm">
                No ground truth elements marked. Enable &quot;Include all
                elements&quot; or mark elements as ground truth.
              </AlertDescription>
            </Alert>
          )}

          {/* Format selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Export Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              className="grid grid-cols-3 gap-2"
            >
              {formatOptions.map((option) => {
                const info = getFormatInfo(option.value);
                return (
                  <div key={option.value}>
                    <RadioGroupItem
                      value={option.value}
                      id={option.value}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={option.value}
                      className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
                    >
                      {option.icon}
                      <span className="text-xs mt-1">{info.name}</span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
            <p className="text-xs text-text-muted">
              {selectedFormatInfo.description}
            </p>
          </div>

          {/* Export destination */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Export Destination</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-text-muted cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[250px]">
                    <p className="text-xs">
                      S3 and local path options require backend integration.
                      Currently falls back to browser download.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <RadioGroup
              value={destination}
              onValueChange={(v) => setDestination(v as ExportDestination)}
              className="grid grid-cols-3 gap-2"
            >
              <div>
                <RadioGroupItem
                  value="download"
                  id="dest-download"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="dest-download"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span className="text-xs mt-1">Download</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="s3"
                  id="dest-s3"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="dest-s3"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
                >
                  <Cloud className="h-4 w-4" />
                  <span className="text-xs mt-1">S3 Bucket</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem
                  value="local"
                  id="dest-local"
                  className="peer sr-only"
                />
                <Label
                  htmlFor="dest-local"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span className="text-xs mt-1">Local Path</span>
                </Label>
              </div>
            </RadioGroup>

            {/* S3 Configuration */}
            {destination === "s3" && (
              <div className="space-y-3 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <Info className="h-3 w-3" />
                  <span>
                    Backend integration required - falls back to download
                  </span>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">S3 Bucket</Label>
                  <Input
                    placeholder="my-training-bucket"
                    value={s3Config.bucket}
                    onChange={(e) =>
                      setS3Config({ ...s3Config, bucket: e.target.value })
                    }
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Prefix (Path)</Label>
                  <Input
                    placeholder="training-data/"
                    value={s3Config.prefix}
                    onChange={(e) =>
                      setS3Config({ ...s3Config, prefix: e.target.value })
                    }
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Region</Label>
                  <Input
                    placeholder="us-east-1"
                    value={s3Config.region}
                    onChange={(e) =>
                      setS3Config({ ...s3Config, region: e.target.value })
                    }
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {/* Local Path Configuration */}
            {destination === "local" && (
              <div className="space-y-3 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
                <div className="flex items-center gap-2 text-xs text-amber-500">
                  <Info className="h-3 w-3" />
                  <span>
                    Backend integration required - falls back to download
                  </span>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Local Directory Path</Label>
                  <Input
                    placeholder="/path/to/training/data"
                    value={localPathConfig.path}
                    onChange={(e) =>
                      setLocalPathConfig({ path: e.target.value })
                    }
                    className="text-sm font-mono"
                  />
                  <p className="text-xs text-text-muted">
                    Path on the server where training data will be saved
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Include all toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Include All Elements
              </Label>
              <p className="text-xs text-text-muted">
                Export all {totalCount} elements, not just ground truth
              </p>
            </div>
            <Switch
              checked={includeAllElements}
              onCheckedChange={setIncludeAllElements}
            />
          </div>

          {/* Export preview */}
          <div className="rounded-lg bg-surface-canvas p-3 border border-border-subtle">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Elements to export:</span>
              <Badge variant="outline" className="font-mono">
                {includeAllElements ? totalCount : groundTruthCount}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-muted">Output file:</span>
              <span className="font-mono text-xs">
                {format === "coco" && "annotations.json"}
                {format === "yolo" && "annotations.txt + classes.txt"}
                {format === "csv" && "annotations.csv"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-text-muted">Destination:</span>
              <span className="text-xs flex items-center gap-1">
                {destination === "download" && (
                  <>
                    <Download className="h-3 w-3" />
                    Browser Download
                  </>
                )}
                {destination === "s3" && (
                  <>
                    <Cloud className="h-3 w-3" />
                    {s3Config.bucket
                      ? `s3://${s3Config.bucket}/${s3Config.prefix}`
                      : "S3 Bucket"}
                  </>
                )}
                {destination === "local" && (
                  <>
                    <FolderOpen className="h-3 w-3" />
                    {localPathConfig.path || "Local Path"}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={
              (groundTruthCount === 0 && !includeAllElements) ||
              totalCount === 0 ||
              !isDestinationConfigured() ||
              isExporting
            }
            className="bg-[#9B59B6] hover:bg-[#9B59B6]/90"
          >
            {destination === "download" && (
              <Download className="h-4 w-4 mr-2" />
            )}
            {destination === "s3" && <Cloud className="h-4 w-4 mr-2" />}
            {destination === "local" && <HardDrive className="h-4 w-4 mr-2" />}
            {isExporting ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
