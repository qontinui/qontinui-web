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

export function ExportPanel() {
  const stats = useExtractionStore((state) => state.stats);
  const [exportFormat, setExportFormat] = useState<
    "coco" | "yolo" | "jsonl" | "state"
  >("coco");
  const [includeStates, setIncludeStates] = useState(true);

  const handleExport = async () => {
    // TODO: Trigger export via runner
    console.log("Exporting as:", exportFormat, { includeStates });
  };

  const handleImportToWorkflow = async () => {
    // TODO: Import states to workflow
    console.log("Importing to workflow");
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

          <Button onClick={handleExport} className="w-full">
            <Download className="mr-2 h-4 w-4" />
            Export Training Data
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
            variant="outline"
            className="w-full"
          >
            Import to Current Workflow
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
