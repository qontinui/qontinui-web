"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileText, FolderOpen, Upload } from "lucide-react";

interface BatchImportFilePickerProps {
  importing: boolean;
  hasFiles: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFolderSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function BatchImportFilePicker({
  importing,
  hasFiles,
  fileInputRef,
  folderInputRef,
  onFileSelect,
  onFolderSelect,
}: BatchImportFilePickerProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>Select Files or Folder</Label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <FileText className="h-4 w-4 mr-2" />
            Select Files
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => folderInputRef.current?.click()}
            disabled={importing}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Select Folder
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".json,.txt,.csv"
            onChange={onFileSelect}
            className="hidden"
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error - webkitdirectory is not in types
            webkitdirectory=""
            directory=""
            onChange={onFolderSelect}
            className="hidden"
          />
        </div>
      </div>

      {!hasFiles && (
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Click to select files or use the buttons above
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Supports .json, .txt, .csv files
          </p>
        </div>
      )}
    </>
  );
}
