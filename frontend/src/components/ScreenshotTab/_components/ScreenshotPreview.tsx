import React from "react";
import { Image } from "lucide-react";
import { Screenshot } from "../../../types/Screenshot";
import { QontinuiMain } from "../../qontinui";

interface ScreenshotPreviewProps {
  selectedScreenshot: Screenshot | null;
  zoomMode: "fit" | "original";
}

export const ScreenshotPreview: React.FC<ScreenshotPreviewProps> = ({
  selectedScreenshot,
  zoomMode,
}) => {
  return (
    <QontinuiMain>
      {selectedScreenshot ? (
        <div className="p-6 h-full">
          <div className="relative inline-block">
            {selectedScreenshot.imageData ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedScreenshot.imageData}
                  alt={selectedScreenshot.name}
                  className="border border-border-default shadow-lg bg-surface-raised"
                  style={{
                    maxWidth: zoomMode === "fit" ? "100%" : "none",
                    height: "auto",
                  }}
                />
                <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                  <span>
                    {selectedScreenshot.width} x {selectedScreenshot.height}
                    px
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center w-96 h-64 border border-border-default bg-surface-raised text-text-muted">
                Image not available
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            {/* eslint-disable-next-line jsx-a11y/alt-text -- This is a Lucide icon component, not an img element */}
            <Image className="w-12 h-12 mx-auto mb-2" aria-hidden="true" />
            <p>Upload screenshots to begin</p>
          </div>
        </div>
      )}
    </QontinuiMain>
  );
};
