"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Camera, Image as Trash2, Check } from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ScreenshotSelectorProps {
  selectedScreenshot: string;
  onSelectScreenshot: (screenshotId: string) => void;
  trigger?: React.ReactNode;
  allowUpload?: boolean;
  multiSelect?: boolean;
  selectedScreenshots?: string[];
  onSelectScreenshots?: (screenshotIds: string[]) => void;
}

const DEFAULT_SELECTED_SCREENSHOTS: string[] = [];

export function ScreenshotSelector({
  selectedScreenshot,
  onSelectScreenshot,
  trigger,
  allowUpload = true,
  multiSelect = false,
  selectedScreenshots = DEFAULT_SELECTED_SCREENSHOTS,
  onSelectScreenshots,
}: ScreenshotSelectorProps) {
  const { screenshots, addScreenshot, deleteScreenshot } = useAutomation();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tempSelectedScreenshots, setTempSelectedScreenshots] =
    useState<string[]>(selectedScreenshots);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    setUploading(true);

    try {
      // Convert to base64 and validate dimensions
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;

        // Create image element to get dimensions
        const img = new Image();
        img.onload = () => {
          // Validate image dimensions
          if (img.width < 10 || img.height < 10) {
            toast.error("Image too small", {
              description: `${file.name} is ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`,
            });
            setUploading(false);
            return;
          }

          const newScreenshot = {
            id: `screenshot-${Date.now()}`,
            name: file.name,
            url: base64,
            size: file.size,
            uploadedAt: new Date(),
          };

          addScreenshot(newScreenshot);
          toast.success("Screenshot uploaded successfully");

          // Auto-select the uploaded screenshot
          onSelectScreenshot(newScreenshot.id);
          setOpen(false);
          setUploading(false);
        };
        img.onerror = () => {
          toast.error("Failed to process image", {
            description: `${file.name} could not be loaded.`,
          });
          setUploading(false);
        };
        img.src = base64;
      };

      reader.readAsDataURL(file);
    } catch (error) {
      toast.error("Failed to upload screenshot");
      console.error(error);
      setUploading(false);
    }
  };

  const handleDeleteScreenshot = (
    e: React.MouseEvent,
    screenshotId: string
  ) => {
    e.stopPropagation();

    if (selectedScreenshot === screenshotId) {
      onSelectScreenshot("");
    }

    deleteScreenshot(screenshotId);
    toast.success("Screenshot deleted");
  };

  const handleSelectScreenshot = (screenshotId: string) => {
    if (multiSelect) {
      setTempSelectedScreenshots((prev) => {
        if (prev.includes(screenshotId)) {
          return prev.filter((id) => id !== screenshotId);
        } else {
          return [...prev, screenshotId];
        }
      });
    } else {
      onSelectScreenshot(screenshotId);
      setOpen(false);
    }
  };

  const handleConfirmSelection = () => {
    if (multiSelect && onSelectScreenshots) {
      onSelectScreenshots(tempSelectedScreenshots);
      setOpen(false);
    }
  };

  const handleCancel = () => {
    setTempSelectedScreenshots(selectedScreenshots);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (newOpen) {
          setTempSelectedScreenshots(selectedScreenshots);
        }
        setOpen(newOpen);
      }}
    >
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            className="w-full justify-start border-border-default bg-transparent hover:bg-surface-raised"
          >
            <Camera className="w-4 h-4 mr-2" />
            {selectedScreenshot
              ? screenshots.find((s) => s.id === selectedScreenshot)?.name ||
                "Select screenshot"
              : "Select screenshot"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {multiSelect ? "Select Screenshots" : "Select Screenshot"}
          </DialogTitle>
          <DialogDescription>
            {multiSelect
              ? "Choose one or more screenshots to add"
              : "Choose a screenshot to use as the initial GUI state for integration testing"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {allowUpload && (
            <div className="mb-4">
              <Label
                htmlFor="screenshot-upload"
                className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-brand-primary text-black font-medium rounded hover:bg-brand-primary/80 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload Screenshot
                <Input
                  id="screenshot-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </Label>
            </div>
          )}

          <ScrollArea className="flex-1">
            {screenshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-text-muted">
                <Camera className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-lg">No screenshots uploaded yet</p>
                <p className="text-sm">Upload a screenshot to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4 p-2">
                {screenshots.map((screenshot) => (
                  <div
                    key={screenshot.id}
                    role="option"
                    aria-selected={multiSelect ? tempSelectedScreenshots.includes(screenshot.id) : selectedScreenshots.includes(screenshot.id)}
                    tabIndex={0}
                    onClick={() => handleSelectScreenshot(screenshot.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectScreenshot(screenshot.id); } }}
                    className={cn(
                      "group relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:scale-105",
                      multiSelect
                        ? tempSelectedScreenshots.includes(screenshot.id)
                          ? "border-brand-primary ring-2 ring-brand-primary/50"
                          : "border-border-default hover:border-border-subtle"
                        : selectedScreenshot === screenshot.id
                          ? "border-brand-primary ring-2 ring-brand-primary/50"
                          : "border-border-default hover:border-border-subtle"
                    )}
                  >
                    <div className="aspect-video bg-surface-canvas">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={screenshot.url}
                        alt={screenshot.name}
                        className="w-full h-full object-contain"
                      />
                    </div>

                    {(multiSelect
                      ? tempSelectedScreenshots.includes(screenshot.id)
                      : selectedScreenshot === screenshot.id) && (
                      <div className="absolute top-2 right-2 bg-brand-primary text-black rounded-full p-1">
                        <Check className="w-4 h-4" />
                      </div>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDeleteScreenshot(e, screenshot.id)}
                      className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>

                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-xs text-white truncate">
                        {screenshot.name}
                      </p>
                      <p className="text-xs text-text-muted">
                        {new Date(screenshot.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {multiSelect && (
            <div className="flex justify-end gap-2 pt-4 border-t mt-4">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirmSelection}
                className="bg-brand-primary text-black hover:bg-brand-primary/80"
              >
                Add {tempSelectedScreenshots.length} Screenshot
                {tempSelectedScreenshots.length !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
