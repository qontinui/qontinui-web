import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { X, Image as ImageIcon } from "lucide-react";

interface ScreenshotListProps {
  screenshots: File[];
  selectedIndex: number;
  onSelectScreenshot: (index: number) => void;
  onRemove: (index: number, e: React.MouseEvent) => void;
  getThumbnailUrl: (file: File) => string | undefined;
}

const ScreenshotList: React.FC<ScreenshotListProps> = ({
  screenshots,
  selectedIndex,
  onSelectScreenshot,
  onRemove,
  getThumbnailUrl,
}) => {
  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {screenshots.map((file, index) => (
          <div
            key={index}
            role="option"
            tabIndex={0}
            aria-selected={selectedIndex === index}
            className={cn(
              "relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all",
              selectedIndex === index
                ? "border-blue-500 shadow-md"
                : "border-border-subtle hover:border-border-default"
            )}
            onClick={() => onSelectScreenshot(index)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectScreenshot(index); } }}
          >
            {/* Thumbnail */}
            <div className="aspect-video bg-surface-raised flex items-center justify-center overflow-hidden">
              {(() => {
                const thumbnailUrl = getThumbnailUrl(file);

                if (thumbnailUrl) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailUrl}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                  );
                } else {
                  return <ImageIcon className="h-8 w-8 text-text-muted" />;
                }
              })()}
            </div>

            {/* Filename */}
            <div className="p-2">
              <p className="text-xs truncate">{file.name}</p>
              <p className="text-xs text-text-muted">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>

            {/* Remove button */}
            <button
              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => onRemove(index, e)}
            >
              <X className="h-3 w-3" />
            </button>

            {/* Selection indicator */}
            {selectedIndex === index && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-blue-500" />
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};

export default ScreenshotList;
