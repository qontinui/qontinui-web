// components/integration-testing/ReportExportButton.tsx

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FileText, Download, Loader2 } from "lucide-react";
import type { MockExecutionResponse } from "@/types/integration-testing";
import { generatePDFReport } from "@/lib/api/integration-testing";

interface ReportExportButtonProps {
  result: MockExecutionResponse;
  screenshotsDir?: string;
  className?: string;
}

interface PDFOptions {
  includeScreenshots: boolean;
  includeCoverage: boolean;
  includeTimeline: boolean;
  includeRecommendations: boolean;
  includeAppendices: boolean;
  screenshotQuality: "low" | "medium" | "high";
  pageSize: "letter" | "a4";
  title?: string;
}

export function ReportExportButton({
  result,
  screenshotsDir,
  className,
}: ReportExportButtonProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [options, setOptions] = useState<PDFOptions>({
    includeScreenshots: true,
    includeCoverage: true,
    includeTimeline: true,
    includeRecommendations: true,
    includeAppendices: true,
    screenshotQuality: "medium",
    pageSize: "letter",
    title: undefined,
  });

  const handleExport = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      // Determine screenshots directory
      const screenshotPath =
        screenshotsDir || `/tmp/qontinui/screenshots/${result.workflow_id}`;

      // Generate PDF
      const blob = await generatePDFReport({
        executionResult: result,
        screenshotsDir: screenshotPath,
        ...options,
      });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.workflow_name}_report_${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Close dialog
      setShowOptions(false);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate PDF report"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setShowOptions(true)}
        className={className}
      >
        <FileText className="h-4 w-4 mr-2" />
        Export PDF Report
      </Button>

      <Dialog open={showOptions} onOpenChange={setShowOptions}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>PDF Report Options</DialogTitle>
            <DialogDescription>
              Configure the PDF report for {result.workflow_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Report Sections */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Report Sections</h4>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="screenshots"
                    checked={options.includeScreenshots}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        includeScreenshots: checked as boolean,
                      }))
                    }
                  />
                  <Label htmlFor="screenshots" className="cursor-pointer">
                    Include Screenshots
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="coverage"
                    checked={options.includeCoverage}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        includeCoverage: checked as boolean,
                      }))
                    }
                  />
                  <Label htmlFor="coverage" className="cursor-pointer">
                    Include Coverage Analysis
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="timeline"
                    checked={options.includeTimeline}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        includeTimeline: checked as boolean,
                      }))
                    }
                  />
                  <Label htmlFor="timeline" className="cursor-pointer">
                    Include Action Timeline
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="recommendations"
                    checked={options.includeRecommendations}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        includeRecommendations: checked as boolean,
                      }))
                    }
                  />
                  <Label htmlFor="recommendations" className="cursor-pointer">
                    Include Recommendations
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="appendices"
                    checked={options.includeAppendices}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        includeAppendices: checked as boolean,
                      }))
                    }
                  />
                  <Label htmlFor="appendices" className="cursor-pointer">
                    Include Full Screenshots Appendix
                  </Label>
                </div>
              </div>
            </div>

            {/* Screenshot Quality */}
            {options.includeScreenshots && (
              <div className="space-y-2">
                <Label htmlFor="quality">Screenshot Quality</Label>
                <Select
                  value={options.screenshotQuality}
                  onValueChange={(value: "low" | "medium" | "high") =>
                    setOptions((prev) => ({
                      ...prev,
                      screenshotQuality: value,
                    }))
                  }
                >
                  <SelectTrigger id="quality">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">
                      Low (smaller file, faster)
                    </SelectItem>
                    <SelectItem value="medium">Medium (balanced)</SelectItem>
                    <SelectItem value="high">
                      High (larger file, best quality)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Page Size */}
            <div className="space-y-2">
              <Label htmlFor="pageSize">Page Size</Label>
              <Select
                value={options.pageSize}
                onValueChange={(value: "letter" | "a4") =>
                  setOptions((prev) => ({ ...prev, pageSize: value }))
                }
              >
                <SelectTrigger id="pageSize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="letter">Letter (8.5" x 11")</SelectItem>
                  <SelectItem value="a4">A4 (210mm x 297mm)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Title */}
            <div className="space-y-2">
              <Label htmlFor="title">
                Custom Title <span className="text-gray-400">(optional)</span>
              </Label>
              <Input
                id="title"
                placeholder="Integration Test Report"
                value={options.title || ""}
                onChange={(e) =>
                  setOptions((prev) => ({ ...prev, title: e.target.value }))
                }
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* File Size Estimate */}
            <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
              <p className="text-sm">
                <strong>Estimated file size:</strong>{" "}
                {estimateFileSize(result, options)}
              </p>
              <p className="text-xs mt-1 text-blue-600">
                Actual size may vary based on screenshot content and
                compression.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowOptions(false)}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Estimate PDF file size based on content and options
 */
function estimateFileSize(
  result: MockExecutionResponse,
  options: PDFOptions
): string {
  let sizeKB = 50; // Base PDF overhead

  const actionCount = result.total_actions;

  // Screenshots contribution
  if (options.includeScreenshots) {
    const screenshotSizePerImage =
      options.screenshotQuality === "high"
        ? 200
        : options.screenshotQuality === "medium"
          ? 100
          : 50;

    // Timeline thumbnails
    if (options.includeTimeline) {
      sizeKB += actionCount * screenshotSizePerImage * 0.3; // 30% size for thumbnails
    }

    // Full screenshots in appendix
    if (options.includeAppendices) {
      sizeKB += actionCount * screenshotSizePerImage;
    }
  }

  // Tables and text
  sizeKB += actionCount * 2; // Rough estimate for tables

  // Coverage analysis
  if (options.includeCoverage) {
    sizeKB += 100; // Charts and tables
  }

  // Convert to human-readable format
  if (sizeKB < 1024) {
    return `~${Math.round(sizeKB)} KB`;
  } else {
    return `~${(sizeKB / 1024).toFixed(1)} MB`;
  }
}
