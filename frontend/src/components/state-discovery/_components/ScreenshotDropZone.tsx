import React from "react";
import { Image as ImageIcon } from "lucide-react";

interface ScreenshotDropZoneProps {
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}

const ScreenshotDropZone: React.FC<ScreenshotDropZoneProps> = ({
  onDrop,
  onDragOver,
}) => {
  return (
    <div
      className="border-2 border-dashed border-border-default rounded-lg p-6 text-center hover:border-border-subtle transition-colors"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ImageIcon className="mx-auto h-12 w-12 text-text-muted mb-2" />
      <p className="text-sm text-text-secondary">Drag and drop images here</p>
      <p className="text-xs text-text-muted mt-1">PNG, JPG up to 50MB</p>
    </div>
  );
};

export default ScreenshotDropZone;
