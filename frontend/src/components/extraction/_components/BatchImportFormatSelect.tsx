"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getImportFormatInfo,
  type ImportFormat,
} from "@/lib/training-data-import";

interface BatchImportFormatSelectProps {
  format: ImportFormat;
  onFormatChange: (format: ImportFormat) => void;
  disabled: boolean;
}

export function BatchImportFormatSelect({
  format,
  onFormatChange,
  disabled,
}: BatchImportFormatSelectProps) {
  const formatInfo = getImportFormatInfo(format);

  return (
    <div className="space-y-2">
      <Label htmlFor="batch-format">Format</Label>
      <Select
        value={format}
        onValueChange={(v) => onFormatChange(v as ImportFormat)}
        disabled={disabled}
      >
        <SelectTrigger id="batch-format">
          <SelectValue placeholder="Select format" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto-detect</SelectItem>
          <SelectItem value="coco">COCO JSON</SelectItem>
          <SelectItem value="yolo">YOLO</SelectItem>
          <SelectItem value="csv">CSV</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{formatInfo.description}</p>
    </div>
  );
}
