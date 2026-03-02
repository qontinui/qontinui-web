/**
 * Format Selector
 *
 * Radio group for choosing the export format (COCO, YOLO, CSV).
 */

import { FileJson, FileText, Table } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { getFormatInfo, type ExportFormat } from "@/lib/training-data-export";

interface FormatSelectorProps {
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; icon: React.ReactNode }[] = [
  { value: "coco", icon: <FileJson className="h-4 w-4" /> },
  { value: "yolo", icon: <FileText className="h-4 w-4" /> },
  { value: "csv", icon: <Table className="h-4 w-4" /> },
];

export function FormatSelector({
  format,
  onFormatChange,
}: FormatSelectorProps) {
  const selectedFormatInfo = getFormatInfo(format);

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Export Format</Label>
      <RadioGroup
        value={format}
        onValueChange={(v) => onFormatChange(v as ExportFormat)}
        className="grid grid-cols-3 gap-2"
      >
        {FORMAT_OPTIONS.map((option) => {
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
  );
}
