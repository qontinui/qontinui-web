"use client";

import { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, FileArchive, X } from "lucide-react";

interface FileDropZoneProps {
  file: File | null;
  dragActive: boolean;
  disabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDrag: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearFile: () => void;
}

export function FileDropZone({
  file,
  dragActive,
  disabled,
  fileInputRef,
  onDrag,
  onDrop,
  onFileInputChange,
  onClearFile,
}: FileDropZoneProps) {
  return (
    <div className="space-y-2">
      <Label>Recording File *</Label>
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : file
              ? "border-green-500 bg-green-50 dark:bg-green-950"
              : "border-border hover:border-primary/50"
        }`}
        onDragEnter={onDrag}
        onDragLeave={onDrag}
        onDragOver={onDrag}
        onDrop={onDrop}
      >
        {file ? (
          <div className="flex items-center justify-center space-x-3">
            <FileArchive className="h-8 w-8 text-green-600" />
            <div className="text-left">
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            {!disabled && (
              <Button variant="ghost" size="sm" onClick={onClearFile}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium">
                Drag and drop your recording ZIP file here
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                or click to browse (max 500MB)
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              Browse Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={onFileInputChange}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
