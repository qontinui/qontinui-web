"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, Upload, RefreshCw } from "lucide-react";

export function ExportImportPanel() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      const data = {
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        workflows: [],
        states: [],
        images: [],
        transitions: [],
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, 2000);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="w-5 h-5 text-brand-primary" />
            Export Project
          </CardTitle>
          <CardDescription>Download complete project backup</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between p-2 rounded bg-surface-hover/30">
              <span className="text-text-muted">Workflows</span>
              <Badge
                variant="outline"
                className="bg-surface-hover/50 border-border-default"
              >
                142
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-surface-hover/30">
              <span className="text-text-muted">States</span>
              <Badge
                variant="outline"
                className="bg-surface-hover/50 border-border-default"
              >
                387
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-surface-hover/30">
              <span className="text-text-muted">Images</span>
              <Badge
                variant="outline"
                className="bg-surface-hover/50 border-border-default"
              >
                1,243
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-surface-hover/30">
              <span className="text-text-muted">Transitions</span>
              <Badge
                variant="outline"
                className="bg-surface-hover/50 border-border-default"
              >
                524
              </Badge>
            </div>
          </div>
          <Separator />
          <div className="text-xs text-text-muted">
            <p className="mb-2">Export includes:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>All workflow definitions</li>
              <li>State configurations</li>
              <li>Image assets and metadata</li>
              <li>Transition configurations</li>
              <li>Folder organization</li>
            </ul>
          </div>
          <Button
            className="w-full bg-brand-primary hover:bg-brand-primary/80 text-black"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export Project
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="w-5 h-5 text-brand-secondary" />
            Import Project
          </CardTitle>
          <CardDescription>
            Restore from backup or merge projects
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-border-subtle rounded-lg p-8 text-center hover:border-border-default transition-colors cursor-pointer">
            <Upload className="w-8 h-8 mx-auto mb-3 text-text-muted" />
            <p className="text-sm text-text-muted mb-1">
              Drop backup file here or click to browse
            </p>
            <p className="text-xs text-text-muted">
              Supports .json and .zip formats
            </p>
          </div>
          <Separator />
          <div className="space-y-2">
            <label className="text-sm font-medium">Import Options</label>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="merge"
                  defaultChecked
                  className="rounded"
                />
                <label htmlFor="merge" className="text-text-muted">
                  Merge with existing data
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="replace" className="rounded" />
                <label htmlFor="replace" className="text-text-muted">
                  Replace existing items
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="backup-before"
                  defaultChecked
                  className="rounded"
                />
                <label htmlFor="backup-before" className="text-text-muted">
                  Create backup before import
                </label>
              </div>
            </div>
          </div>
          <Button
            className="w-full bg-brand-secondary hover:bg-brand-secondary/80 text-white"
            onClick={() => setIsImporting(true)}
            disabled={isImporting}
          >
            {isImporting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import Project
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
