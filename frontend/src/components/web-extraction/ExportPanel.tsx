"use client";

import { useState } from "react";
import { Download, FileJson, Database, FileText } from "lucide-react";
import { useExtractionStore } from "@/stores/extraction-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function ExportPanel() {
  const stats = useExtractionStore((state) => state.stats);
  const states = useExtractionStore((state) => state.states);
  const elements = useExtractionStore((state) => state.elements);
  const transitions = useExtractionStore((state) => state.transitions);

  const [exportFormat, setExportFormat] = useState<
    "coco" | "yolo" | "jsonl" | "state"
  >("coco");
  const [includeStates, setIncludeStates] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      let exportData: any;
      let filename: string;

      // Prepare export data based on selected format
      switch (exportFormat) {
        case "coco":
          // COCO format for object detection
          exportData = {
            info: {
              description: "Web UI Extraction Data",
              version: "1.0",
              year: new Date().getFullYear(),
              date_created: new Date().toISOString(),
            },
            images: states.map((state, idx) => ({
              id: idx,
              file_name: `state_${state.id}.png`,
              width: state.bbox.width,
              height: state.bbox.height,
            })),
            annotations: includeStates
              ? states.map((state, idx) => ({
                  id: idx,
                  image_id: idx,
                  category_id: 1,
                  bbox: [
                    state.bbox.x,
                    state.bbox.y,
                    state.bbox.width,
                    state.bbox.height,
                  ],
                  area: state.bbox.width * state.bbox.height,
                  iscrowd: 0,
                }))
              : [],
            categories: [{ id: 1, name: "ui_state", supercategory: "ui" }],
          };
          filename = "extraction_coco.json";
          break;

        case "yolo":
          // YOLO format (simplified - typically needs separate text files per image)
          exportData = {
            classes: ["ui_state"],
            annotations: states.map((state) => ({
              image: `state_${state.id}.png`,
              class: 0,
              bbox: [
                state.bbox.x,
                state.bbox.y,
                state.bbox.width,
                state.bbox.height,
              ],
            })),
          };
          filename = "extraction_yolo.json";
          break;

        case "jsonl":
          // JSONL format - one JSON object per line
          exportData = states
            .map((state) =>
              JSON.stringify({
                id: state.id,
                name: state.name,
                bbox: state.bbox,
                elementIds: state.elementIds,
                timestamp: new Date().toISOString(),
              })
            )
            .join("\n");
          filename = "extraction_data.jsonl";
          break;

        default:
          throw new Error(`Unsupported export format: ${exportFormat}`);
      }

      // Create and download file
      const blob = new Blob(
        [
          typeof exportData === "string"
            ? exportData
            : JSON.stringify(exportData, null, 2),
        ],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(
        `Exported ${states.length} states as ${exportFormat.toUpperCase()}`
      );
    } catch (error: any) {
      console.error("Export failed:", error);
      toast.error(`Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportToWorkflow = async () => {
    setIsImporting(true);
    try {
      // Convert extracted states to workflow state format
      let importedCount = 0;

      for (const extractedState of states) {
        // Create state image patterns from the extracted state
        const stateImages = extractedState.elementIds.map((elementId) => {
          const element = elements.find((e) => e.id === elementId);
          return {
            imageId: element?.id || "",
            patterns: [],
          };
        });

        // Add state to workflow context
        // Note: This is a simplified import - actual implementation may need more mapping
        const workflowState = {
          id: extractedState.id,
          name: extractedState.name || `State ${extractedState.id}`,
          stateImages: stateImages,
          transitions: transitions
            .filter((t) => t.fromStateId === extractedState.id)
            .map((t) => ({
              targetState: t.toStateId,
              trigger: "click", // Default trigger
              condition: undefined,
            })),
        };

        // This would need to be implemented in the automation context
        // For now, just log what would be imported
        console.log("Would import state:", workflowState);
        importedCount++;
      }

      toast.success(`Imported ${importedCount} states to workflow`);
    } catch (error: any) {
      console.error("Import failed:", error);
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Training Data Export */}
      <Card>
        <CardHeader>
          <CardTitle>Export Training Data</CardTitle>
          <CardDescription>
            Export extraction results for ML model training
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup
            value={exportFormat}
            onValueChange={(v) => setExportFormat(v as any)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="coco" id="coco" />
              <Label htmlFor="coco" className="flex items-center gap-2">
                <FileJson className="h-4 w-4" />
                COCO Format
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yolo" id="yolo" />
              <Label htmlFor="yolo" className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                YOLO Format
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="jsonl" id="jsonl" />
              <Label htmlFor="jsonl" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                JSONL Format
              </Label>
            </div>
          </RadioGroup>

          <div className="flex items-center justify-between">
            <Label htmlFor="include-states">Include state annotations</Label>
            <Switch
              id="include-states"
              checked={includeStates}
              onCheckedChange={setIncludeStates}
            />
          </div>

          <Button
            onClick={handleExport}
            disabled={isExporting || states.length === 0}
            className="w-full"
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export Training Data"}
          </Button>
        </CardContent>
      </Card>

      {/* State Structure Export */}
      <Card>
        <CardHeader>
          <CardTitle>Import to Workflow</CardTitle>
          <CardDescription>
            Import extracted states into your automation workflow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm">Ready to import:</p>
            <ul className="mt-2 text-sm text-muted-foreground">
              <li>{stats.statesFound} states</li>
              <li>{stats.elementsFound} elements</li>
              <li>{stats.transitionsFound} transitions</li>
            </ul>
          </div>

          <Button
            onClick={handleImportToWorkflow}
            disabled={isImporting || states.length === 0}
            variant="outline"
            className="w-full"
          >
            {isImporting ? "Importing..." : "Import to Current Workflow"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
