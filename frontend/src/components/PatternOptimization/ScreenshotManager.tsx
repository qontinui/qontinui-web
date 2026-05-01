"use client";

import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Upload,
  Trash2,
  Image as ImageIcon,
  CheckCircle,
  XCircle,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePatternOptimization } from "@/contexts/pattern-optimization-context";
import { ScreenshotImage } from "./ScreenshotImage";
import type { OptimizationScreenshot } from "@/types/pattern-optimization";

export function ScreenshotManager() {
  const { session, addScreenshots, removeScreenshot, labelScreenshot } =
    usePatternOptimization();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = useCallback(
    async (files: FileList) => {
      setUploading(true);
      const newScreenshots: OptimizationScreenshot[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;

        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name} is not an image`);
          continue;
        }

        const reader = new FileReader();
        const result = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Validate dimensions
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = result;
        });

        if (img.width < 10 || img.height < 10) {
          toast.error(
            `${file.name} is too small (${img.width}x${img.height}). Minimum size is 10x10`
          );
          continue;
        }

        newScreenshots.push({
          id: `screenshot-${Date.now()}-${i}`,
          url: result,
          name: file.name,
          uploadedAt: new Date(),
          label: "unlabeled",
        });
      }

      if (newScreenshots.length > 0) {
        addScreenshots(newScreenshots);
        toast.success(`Added ${newScreenshots.length} screenshot(s)`);
      }

      setUploading(false);
    },
    [addScreenshots]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files);
      }
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!session?.screenshots) return;
    setSelectedIds(new Set(session.screenshots.map((s) => s.id)));
  }, [session]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const labelSelected = useCallback(
    (label: "positive" | "negative" | "unlabeled") => {
      selectedIds.forEach((id) => {
        labelScreenshot(id, label);
      });
      toast.success(`Labeled ${selectedIds.size} screenshot(s) as ${label}`);
      deselectAll();
    },
    [selectedIds, labelScreenshot, deselectAll]
  );

  const removeSelected = useCallback(() => {
    if (selectedIds.size === 0) return;

    if (confirm(`Remove ${selectedIds.size} screenshot(s)?`)) {
      selectedIds.forEach((id) => {
        removeScreenshot(id);
      });
      toast.success(`Removed ${selectedIds.size} screenshot(s)`);
      deselectAll();
    }
  }, [selectedIds, removeScreenshot, deselectAll]);

  const screenshots = session?.screenshots || [];
  const positiveCount = screenshots.filter(
    (s) => s.label === "positive"
  ).length;
  const negativeCount = screenshots.filter(
    (s) => s.label === "negative"
  ).length;
  const unlabeledCount = screenshots.filter(
    (s) => s.label === "unlabeled"
  ).length;

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Quick Help */}
      {screenshots.length === 0 && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-xs">
          <p className="font-medium text-blue-400 mb-1">Quick Start:</p>
          <ol className="space-y-1 text-text-secondary">
            <li>1. Upload screenshots using the button below</li>
            <li>
              2. Label them as <span className="text-green-400">positive</span>{" "}
              (examples to find) or{" "}
              <span className="text-red-400">negative</span> (examples to avoid)
            </li>
            <li>
              3. Draw regions on positive screenshots in the Region Editor
            </li>
            <li>4. Click Analyze to optimize patterns</li>
          </ol>
        </div>
      )}

      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-medium">Screenshots</h3>
          <div className="flex items-center gap-3 text-xs">
            <span
              className="flex items-center gap-1"
              title="Positive examples - what the pattern should match"
            >
              <CheckCircle className="w-3 h-3 text-green-500" />
              <span className="text-text-muted">{positiveCount}</span>
            </span>
            <span
              className="flex items-center gap-1"
              title="Negative examples - what the pattern should NOT match"
            >
              <XCircle className="w-3 h-3 text-red-500" />
              <span className="text-text-muted">{negativeCount}</span>
            </span>
            <span
              className="flex items-center gap-1"
              title="Unlabeled - not yet categorized"
            >
              <Circle className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">{unlabeledCount}</span>
            </span>
          </div>
        </div>

        <Label htmlFor="screenshot-upload" className="cursor-pointer">
          <Button
            size="sm"
            variant="outline"
            className="border-border-default hover:border-brand-primary"
            disabled={uploading}
            asChild
          >
            <span>
              <Upload className="w-3 h-3 mr-1" />
              Upload
            </span>
          </Button>
          <input
            id="screenshot-upload"
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            className="hidden"
          />
        </Label>
      </div>

      {/* Action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-brand-primary/10 border border-brand-primary/30 rounded">
          <span className="text-xs font-medium text-brand-primary">
            {selectedIds.size} selected
          </span>
          <span className="text-xs text-text-muted border-l border-border-default pl-2">
            Apply to all:
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => labelSelected("positive")}
            className="h-6 px-2 text-xs hover:bg-green-500/20"
            title="Mark selected screenshots as positive examples (what to find)"
          >
            <CheckCircle className="w-3 h-3 mr-1 text-green-500" />
            Positive
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => labelSelected("negative")}
            className="h-6 px-2 text-xs hover:bg-red-500/20"
            title="Mark selected screenshots as negative examples (what to avoid)"
          >
            <XCircle className="w-3 h-3 mr-1 text-red-500" />
            Negative
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => labelSelected("unlabeled")}
            className="h-6 px-2 text-xs hover:bg-surface-raised/20"
            title="Remove labels from selected screenshots"
          >
            <Circle className="w-3 h-3 mr-1 text-text-muted" />
            Clear Label
          </Button>
          <div className="ml-auto" />
          <Button
            size="sm"
            variant="ghost"
            onClick={removeSelected}
            className="h-6 px-2 text-xs text-red-400 hover:text-red-500 hover:bg-red-500/20"
            title="Delete selected screenshots"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Remove
          </Button>
        </div>
      )}

      {/* Screenshot grid */}
      <ScrollArea className="flex-1">
        {screenshots.length === 0 ? (
          <Card
            className="border-2 border-dashed border-border-default bg-surface-raised/50 hover:border-border-subtle transition-colors"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <CardContent className="p-8">
              <div className="text-center">
                <ImageIcon className="w-12 h-12 mx-auto mb-2 text-text-muted" />
                <p className="text-sm text-text-muted">
                  Drop screenshots here or click upload
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 mb-2">
              <div className="flex items-center gap-2 p-2 bg-surface-raised/30 rounded border border-border-default">
                <div className="flex-1">
                  <p className="text-xs text-text-muted">
                    <span className="font-medium">Bulk Actions:</span> Select
                    screenshots to label or remove multiple at once
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={selectAll}
                    className="h-6 px-2 text-xs"
                    title="Select all screenshots for bulk actions"
                  >
                    Select All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={deselectAll}
                    className="h-6 px-2 text-xs"
                    title="Clear all selections"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>

            {screenshots.map((screenshot) => (
              <div
                role="button"
                tabIndex={0}
                key={screenshot.id}
                className={cn(
                  "relative group cursor-pointer rounded overflow-hidden border-2 transition-all",
                  selectedIds.has(screenshot.id)
                    ? "border-brand-primary ring-1 ring-brand-primary/50"
                    : "border-border-default hover:border-border-subtle"
                )}
                onClick={() => toggleSelection(screenshot.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).click();
                  }
                }}
              >
                <div className="aspect-video bg-surface-canvas relative">
                  <ScreenshotImage
                    screenshotId={screenshot.id}
                    fallbackUrl={screenshot.url}
                    alt={screenshot.name}
                    className="w-full h-full object-contain"
                  />

                  {/* Label indicator */}
                  <div className="absolute top-1 right-1">
                    {screenshot.label === "positive" && (
                      <CheckCircle className="w-4 h-4 text-green-500 bg-black/50 rounded-full" />
                    )}
                    {screenshot.label === "negative" && (
                      <XCircle className="w-4 h-4 text-red-500 bg-black/50 rounded-full" />
                    )}
                  </div>

                  {/* Selection checkbox */}
                  <div
                    className="absolute top-1 left-1"
                    title="Select for bulk actions"
                  >
                    <Checkbox
                      checked={selectedIds.has(screenshot.id)}
                      className="bg-black/50 border-white/50"
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleSelection(screenshot.id)}
                    />
                  </div>

                  {/* Region indicator */}
                  {screenshot.region && (
                    <div className="absolute bottom-1 right-1 bg-black/50 rounded px-1">
                      <span className="text-xs text-brand-success">
                        Region set
                      </span>
                    </div>
                  )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                  <p className="text-xs text-white truncate">
                    {screenshot.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
