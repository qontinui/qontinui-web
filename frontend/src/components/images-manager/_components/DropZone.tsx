"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Upload } from "lucide-react";

interface DropZoneProps {
  dragActive: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onChooseFiles: () => void;
}

export function DropZone({
  dragActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onChooseFiles,
}: DropZoneProps) {
  return (
    <Card
      className={`border-2 border-dashed transition-colors ${
        dragActive
          ? "border-brand-success bg-brand-success/10"
          : "border-border-default bg-surface-raised/50 hover:border-border-subtle"
      }`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CardContent className="p-12">
        <div className="text-center">
          <Upload
            className={`w-12 h-12 mx-auto mb-4 ${dragActive ? "text-brand-success" : "text-text-muted"}`}
          />
          <p className="text-lg mb-2">Drag & drop images here</p>
          <p className="text-sm text-text-muted mb-4">
            or click to browse files
          </p>
          <Button
            variant="outline"
            className="border-border-subtle bg-transparent hover:border-brand-success hover:text-brand-success"
            onClick={onChooseFiles}
          >
            Choose Files
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
