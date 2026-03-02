"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle2, XCircle, Loader2, Trash2 } from "lucide-react";
import type { FileImportResult } from "../_hooks/batch-import-types";

interface BatchImportFileListProps {
  files: File[];
  results: FileImportResult[];
  importing: boolean;
  completedCount: number;
  errorCount: number;
  progress: number;
  onRemoveFile: (fileName: string) => void;
  onClearAll: () => void;
}

export function BatchImportFileList({
  files,
  results,
  importing,
  completedCount,
  errorCount,
  progress,
  onRemoveFile,
  onClearAll,
}: BatchImportFileListProps) {
  if (files.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{files.length} file(s) selected</Label>
        {!importing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      {importing && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Processing {completedCount + errorCount} of {results.length}{" "}
            files...
          </p>
        </div>
      )}

      <ScrollArea className="h-[200px] rounded-md border">
        <div className="p-2 space-y-1">
          {files.map((file, idx) => {
            const result = results[idx];
            return (
              <div
                key={file.name}
                className="flex items-center justify-between p-2 rounded hover:bg-accent/50 text-sm"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {result?.status === "importing" && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  )}
                  {result?.status === "success" && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {result?.status === "error" && (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  {(!result || result.status === "pending") && (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{file.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {result?.status === "success" && (
                    <Badge variant="outline" className="text-xs">
                      {result.elementCount} elements
                    </Badge>
                  )}
                  {result?.status === "error" && (
                    <span className="text-xs text-destructive truncate max-w-[150px]">
                      {result.error}
                    </span>
                  )}
                  {!importing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => onRemoveFile(file.name)}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
