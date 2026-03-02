"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Image from "next/image";

interface ScreenshotDialogProps {
  selectedImage: string | null;
  onClose: () => void;
}

export function ScreenshotDialog({
  selectedImage,
  onClose,
}: ScreenshotDialogProps) {
  return (
    <Dialog open={selectedImage !== null} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Screenshot</DialogTitle>
        </DialogHeader>
        {selectedImage && (
          <div className="relative w-full">
            <Image
              src={selectedImage}
              alt="Full size screenshot"
              width={1200}
              height={800}
              className="rounded border border-border w-full h-auto"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
