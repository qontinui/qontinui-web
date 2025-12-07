"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Download, FileText, Table, Code, CheckCircle } from "lucide-react";
import { DeficiencyExportOptions } from "@/types/deficiency";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DeficiencyExportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (options: DeficiencyExportOptions) => Promise<void>;
  availableTemplates?: string[];
}

/**
 * DeficiencyExport - Export dialog for deficiencies
 *
 * Features:
 * - Export format selection (PDF, CSV, JSON)
 * - Include/exclude options (comments, activity, screenshots)
 * - Template selection for PDF exports
 * - Preview of export options
 * - Loading state during export
 * - Success/error feedback
 */
export function DeficiencyExport({
  open,
  onOpenChange,
  onExport,
  availableTemplates = ["Standard", "Detailed", "Executive Summary"],
}: DeficiencyExportProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [format, setFormat] = useState<"pdf" | "csv" | "json">("pdf");
  const [includeComments, setIncludeComments] = useState(true);
  const [includeActivity, setIncludeActivity] = useState(true);
  const [includeScreenshots, setIncludeScreenshots] = useState(true);
  const [template, setTemplate] = useState(availableTemplates[0] || "Standard");

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const options: DeficiencyExportOptions = {
        format,
        include_comments: includeComments,
        include_activity: includeActivity,
        include_screenshots: includeScreenshots,
        template: format === "pdf" ? template : undefined,
      };

      await onExport(options);
      toast.success(`Export completed as ${format.toUpperCase()}`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Export failed. Please try again.");
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const formatIcons = {
    pdf: FileText,
    csv: Table,
    json: Code,
  };

  const formatDescriptions = {
    pdf: "Formatted document with images and styling",
    csv: "Spreadsheet-compatible data (no images)",
    json: "Raw data for integration and automation",
  };

  const FormatIcon = formatIcons[format];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Deficiencies
          </DialogTitle>
          <DialogDescription>
            Choose export format and options
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <div className="space-y-3">
            <Label>Export Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as any)}
            >
              {(["pdf", "csv", "json"] as const).map((formatOption) => {
                const Icon = formatIcons[formatOption];
                return (
                  <div
                    key={formatOption}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                      format === formatOption
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => setFormat(formatOption)}
                  >
                    <RadioGroupItem
                      value={formatOption}
                      id={`format-${formatOption}`}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <Label
                        htmlFor={`format-${formatOption}`}
                        className="flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <Icon className="h-4 w-4" />
                        {formatOption.toUpperCase()}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDescriptions[formatOption]}
                      </p>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          <Separator />

          {/* Template Selection (PDF only) */}
          {format === "pdf" && (
            <>
              <div className="space-y-3">
                <Label htmlFor="template">PDF Template</Label>
                <Select value={template} onValueChange={setTemplate}>
                  <SelectTrigger id="template">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTemplates.map((tmpl) => (
                      <SelectItem key={tmpl} value={tmpl}>
                        {tmpl}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {template === "Standard" &&
                    "Balanced format with all key information"}
                  {template === "Detailed" &&
                    "Comprehensive report with full details and screenshots"}
                  {template === "Executive Summary" &&
                    "High-level overview for stakeholders"}
                </p>
              </div>
              <Separator />
            </>
          )}

          {/* Include Options */}
          <div className="space-y-3">
            <Label>Include in Export</Label>
            <div className="space-y-3">
              {/* Comments */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="include-comments"
                  checked={includeComments}
                  onCheckedChange={(checked) =>
                    setIncludeComments(checked as boolean)
                  }
                />
                <div className="flex-1">
                  <Label
                    htmlFor="include-comments"
                    className="cursor-pointer font-medium"
                  >
                    Comments
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Team discussion and collaboration notes
                  </p>
                </div>
              </div>

              {/* Activity */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="include-activity"
                  checked={includeActivity}
                  onCheckedChange={(checked) =>
                    setIncludeActivity(checked as boolean)
                  }
                />
                <div className="flex-1">
                  <Label
                    htmlFor="include-activity"
                    className="cursor-pointer font-medium"
                  >
                    Activity Log
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Status changes and audit trail
                  </p>
                </div>
              </div>

              {/* Screenshots */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="include-screenshots"
                  checked={includeScreenshots}
                  onCheckedChange={(checked) =>
                    setIncludeScreenshots(checked as boolean)
                  }
                  disabled={format === "csv" || format === "json"}
                />
                <div className="flex-1">
                  <Label
                    htmlFor="include-screenshots"
                    className={cn(
                      "cursor-pointer font-medium",
                      (format === "csv" || format === "json") &&
                        "text-muted-foreground"
                    )}
                  >
                    Screenshots
                    {(format === "csv" || format === "json") && (
                      <span className="ml-2 text-xs">(PDF only)</span>
                    )}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Visual evidence and error screenshots
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Summary */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FormatIcon className="h-4 w-4" />
              Export Summary
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3" />
                Format: {format.toUpperCase()}
              </div>
              {format === "pdf" && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3" />
                  Template: {template}
                </div>
              )}
              {includeComments && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3" />
                  Including comments
                </div>
              )}
              {includeActivity && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3" />
                  Including activity log
                </div>
              )}
              {includeScreenshots && format === "pdf" && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3 w-3" />
                  Including screenshots
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              "Exporting..."
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
