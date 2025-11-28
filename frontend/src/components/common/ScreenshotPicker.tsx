import React, { useRef } from "react";
import { Upload, X, FolderOpen, ImageIcon } from "lucide-react";
import { ScreenshotSelector } from "@/components/screenshot-selector";

export interface ScreenshotInfo {
  id: string;
  name: string;
  url: string;
}

interface ScreenshotPickerProps {
  currentScreenshot: ScreenshotInfo | null;
  onUploadScreenshot: (file: File) => void;
  onSelectProjectScreenshot: (screenshotId: string) => void;
  onClearScreenshot: () => void;
  showRegionInfo?: boolean;
  regionDimensions?: { width: number; height: number } | null;
  additionalInfo?: React.ReactNode;
  className?: string;
}

/**
 * Reusable screenshot selection component used across Image Extraction, Pattern Matching, and other pages.
 * Provides consistent UI for uploading screenshots or selecting from project screenshots.
 */
export const ScreenshotPicker: React.FC<ScreenshotPickerProps> = ({
  currentScreenshot,
  onUploadScreenshot,
  onSelectProjectScreenshot,
  onClearScreenshot,
  showRegionInfo = false,
  regionDimensions,
  additionalInfo,
  className = "",
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onUploadScreenshot(files[0]);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className={className}>
      {/* Screenshot Selection Buttons */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="font-semibold text-white mb-3">Screenshot</h2>
        <div className="space-y-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-3 py-2 bg-[#00D9FF] text-black rounded-md hover:bg-[#00D9FF]/90 text-sm flex items-center justify-center gap-2 font-medium"
          >
            <Upload className="w-4 h-4" />
            Upload Image
          </button>
          <button
            onClick={() => screenshotSelectorTriggerRef.current?.click()}
            className="w-full px-3 py-2 bg-[#00FF88] text-black rounded-md hover:bg-[#00FF88]/90 text-sm flex items-center justify-center gap-2 font-medium"
          >
            <FolderOpen className="w-4 h-4" />
            From Project
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Current Screenshot Info */}
      <div className="p-4">
        {currentScreenshot ? (
          <div className="space-y-4">
            <div className="p-3 border border-[#00D9FF] bg-[#00D9FF]/10 rounded-lg">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0">
                  <div
                    className="font-medium text-sm text-white truncate"
                    title={currentScreenshot.name}
                  >
                    {currentScreenshot.name}
                  </div>
                </div>
                <button
                  onClick={onClearScreenshot}
                  className="ml-2 p-1 hover:bg-[#00D9FF]/20 rounded transition-colors flex-shrink-0"
                  title="Clear screenshot"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              {showRegionInfo && regionDimensions ? (
                <div className="text-xs text-[#00FF88] mt-1">
                  Region: {Math.round(regionDimensions.width)}×
                  {Math.round(regionDimensions.height)}
                </div>
              ) : showRegionInfo ? (
                <div className="text-xs text-gray-400 mt-1">
                  Select a region on the image
                </div>
              ) : null}
            </div>

            {additionalInfo}
          </div>
        ) : (
          <div className="text-center py-8">
            <ImageIcon className="w-12 h-12 mx-auto mb-2 text-gray-600" />
            <p className="text-sm text-gray-400">No screenshot loaded</p>
            <p className="text-xs text-gray-500 mt-1">
              Upload or select from project
            </p>
          </div>
        )}
      </div>

      {/* Hidden Screenshot Selector Trigger */}
      <ScreenshotSelector
        selectedScreenshot={currentScreenshot?.id || ""}
        onSelectScreenshot={onSelectProjectScreenshot}
        multiSelect={false}
        allowUpload={false}
        trigger={
          <button
            ref={screenshotSelectorTriggerRef}
            style={{ display: "none" }}
          />
        }
      />
    </div>
  );
};
