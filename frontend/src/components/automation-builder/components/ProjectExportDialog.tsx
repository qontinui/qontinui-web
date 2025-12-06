/**
 * ProjectExportDialog Component
 *
 * Exports the entire project configuration as a JSON file
 * that can be imported into qontinui-runner.
 */

import React, { useState, useCallback } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { ConfigExporter } from "@/lib/config-exporter";

export interface ProjectExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectExportDialog({
  open,
  onOpenChange,
}: ProjectExportDialogProps) {
  const {
    projectName,
    images,
    workflows,
    states,
    transitions,
    categories,
    settings,
    screenshots,
  } = useAutomation();

  const [isExporting, setIsExporting] = useState(false);
  const [exportName, setExportName] = useState(projectName);
  const [description, setDescription] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setExportName(projectName);
      setDescription("");
      setValidationErrors([]);
    }
  }, [open, projectName]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setValidationErrors([]);

    try {
      const exporter = new ConfigExporter();

      // Export full configuration
      const config = await exporter.exportConfiguration(
        images,
        workflows,
        states,
        transitions,
        categories,
        {
          name: exportName || projectName,
          description: description || undefined,
          created: new Date().toISOString(),
        },
        settings,
        screenshots as any // Type cast needed: context uses different Screenshot type than ConfigExporter
      );

      // Validate the configuration
      const validation = exporter.validateConfiguration(config);
      if (!validation.valid) {
        setValidationErrors(validation.errors);
        // Still allow export with warnings
        if (validation.errors.length > 0) {
          toast.warning("Export completed with warnings", {
            description: `${validation.errors.length} validation issue(s) found`,
          });
        }
      }

      // Download the configuration
      const filename = `${(exportName || projectName).replace(/[^a-zA-Z0-9-_]/g, "_")}_config.json`;
      exporter.downloadConfiguration(config, filename);

      toast.success("Project exported successfully", {
        description: `Saved as ${filename}`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsExporting(false);
    }
  }, [
    exportName,
    description,
    projectName,
    images,
    workflows,
    states,
    transitions,
    categories,
    settings,
    screenshots,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-gray-950 border-gray-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-[#00D9FF]" />
            Export Project
          </DialogTitle>
          <DialogDescription>
            Export the entire project configuration as a JSON file for use with
            qontinui-runner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Project Name */}
          <div className="space-y-2">
            <Label htmlFor="exportName">Project Name</Label>
            <Input
              id="exportName"
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder="Enter project name"
              className="bg-gray-900 border-gray-700"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description for this export..."
              className="bg-gray-900 border-gray-700 min-h-[80px]"
            />
          </div>

          {/* Export Summary */}
          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-medium text-gray-300">
              Export Summary
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Workflows:</span>
                <span className="text-white">{workflows.length}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>States:</span>
                <span className="text-white">{states.length}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Transitions:</span>
                <span className="text-white">{transitions.length}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Images:</span>
                <span className="text-white">{images.length}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Screenshots:</span>
                <span className="text-white">{screenshots.length}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Categories:</span>
                <span className="text-white">{categories.length}</span>
              </div>
            </div>
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="bg-yellow-950/30 border border-yellow-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-yellow-500">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Validation Warnings</span>
              </div>
              <ul className="text-sm text-yellow-400 space-y-1 list-disc list-inside">
                {validationErrors.slice(0, 5).map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
                {validationErrors.length > 5 && (
                  <li>...and {validationErrors.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-gray-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !exportName.trim()}
            className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export Project
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
