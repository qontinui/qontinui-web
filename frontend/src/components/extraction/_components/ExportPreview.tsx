/**
 * Export Preview
 *
 * Shows a summary of what will be exported: element count, output file, and destination.
 */

import { Download, Cloud, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExportFormat } from "@/lib/training-data-export";
import type {
  ExportDestination,
  S3Config,
  LocalPathConfig,
} from "../_hooks/training-data-export-types";

interface ExportPreviewProps {
  format: ExportFormat;
  destination: ExportDestination;
  includeAllElements: boolean;
  totalCount: number;
  groundTruthCount: number;
  s3Config: S3Config;
  localPathConfig: LocalPathConfig;
}

function getOutputFileName(format: ExportFormat): string {
  switch (format) {
    case "coco":
      return "annotations.json";
    case "yolo":
      return "annotations.txt + classes.txt";
    case "csv":
      return "annotations.csv";
  }
}

export function ExportPreview({
  format,
  destination,
  includeAllElements,
  totalCount,
  groundTruthCount,
  s3Config,
  localPathConfig,
}: ExportPreviewProps) {
  return (
    <div className="rounded-lg bg-surface-canvas p-3 border border-border-subtle">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-muted">Elements to export:</span>
        <Badge variant="outline" className="font-mono">
          {includeAllElements ? totalCount : groundTruthCount}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-sm mt-1">
        <span className="text-text-muted">Output file:</span>
        <span className="font-mono text-xs">{getOutputFileName(format)}</span>
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
  );
}
