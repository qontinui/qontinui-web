/**
 * Hook for managing training data export state and logic.
 *
 * Encapsulates all useState, derived values, and export handlers
 * for the TrainingDataExportDialog.
 */

import { useState } from "react";
import {
  exportTrainingData,
  downloadExport,
  type ExportFormat,
} from "@/lib/training-data-export";
import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import { toast } from "sonner";
import type {
  ExportDestination,
  S3Config,
  LocalPathConfig,
} from "./training-data-export-types";

interface UseTrainingDataExportOptions {
  projectName?: string;
}

export function useTrainingDataExport({
  projectName,
}: UseTrainingDataExportOptions) {
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

  const isDestinationConfigured = (): boolean => {
    if (destination === "download") return true;
    if (destination === "s3") return s3Config.bucket.trim() !== "";
    if (destination === "local") return localPathConfig.path.trim() !== "";
    return false;
  };

  const canExport =
    !((groundTruthCount === 0 && !includeAllElements) || totalCount === 0) &&
    isDestinationConfigured() &&
    !isExporting;

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

      const exportCount = includeAllElements ? totalCount : groundTruthCount;

      const doDownload = () => {
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
      };

      if (destination === "download") {
        doDownload();
        toast.success(`Exported ${exportCount} elements`);
      } else if (destination === "s3") {
        toast.info("S3 export requires backend integration (coming soon)");
        doDownload();
        toast.success(
          `Downloaded ${exportCount} elements (S3 not yet available)`
        );
      } else if (destination === "local") {
        toast.info(
          "Local path export requires backend integration (coming soon)"
        );
        doDownload();
        toast.success(
          `Downloaded ${exportCount} elements (local path not yet available)`
        );
      }

      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return {
    // Dialog state
    open,
    setOpen,

    // Format
    format,
    setFormat,

    // Elements toggle
    includeAllElements,
    setIncludeAllElements,

    // Destination
    destination,
    setDestination,

    // S3 config
    s3Config,
    setS3Config,

    // Local path config
    localPathConfig,
    setLocalPathConfig,

    // Export state
    isExporting,
    handleExport,
    canExport,

    // Derived counts
    groundTruthCount,
    totalCount,
  };
}
