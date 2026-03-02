import React from "react";
import { Camera } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackgroundRemovalResult } from "@/types/backgroundRemoval";

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundImage: `
    linear-gradient(45deg, #3A3A3D 25%, transparent 25%),
    linear-gradient(-45deg, #3A3A3D 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #3A3A3D 75%),
    linear-gradient(-45deg, transparent 75%, #3A3A3D 75%)
  `,
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
  backgroundColor: "hsl(var(--surface-raised))",
};

interface ScreenshotInfo {
  id: string;
  name: string;
  url: string;
}

interface PreviewPanelProps {
  selectedScreenshots: ScreenshotInfo[];
  selectedScreenshotIndex: number;
  setSelectedScreenshotIndex: (index: number) => void;
  selectedScreenshot: ScreenshotInfo | undefined;
  result: BackgroundRemovalResult | null;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  selectedScreenshots,
  selectedScreenshotIndex,
  setSelectedScreenshotIndex,
  selectedScreenshot,
  result,
}) => {
  return (
    <div className="flex-1 flex flex-col p-4 overflow-hidden bg-surface-canvas">
      <Tabs defaultValue="original" className="flex-1 flex flex-col">
        <TabsList className="bg-surface-raised border-border-default">
          <TabsTrigger
            value="original"
            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-text-secondary"
          >
            Original
          </TabsTrigger>
          <TabsTrigger
            value="processed"
            disabled={!result}
            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-text-secondary"
          >
            Processed
          </TabsTrigger>
          <TabsTrigger
            value="comparison"
            disabled={!result}
            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-text-secondary"
          >
            Comparison
          </TabsTrigger>
        </TabsList>

        <TabsContent value="original" className="flex-1 mt-4">
          {selectedScreenshot ? (
            <div className="h-full flex flex-col">
              <div className="flex gap-2 mb-2 overflow-x-auto">
                {selectedScreenshots.map((screenshot, index) => (
                  <button
                    key={screenshot.id}
                    onClick={() => setSelectedScreenshotIndex(index)}
                    className={`px-3 py-1 rounded text-sm ${
                      index === selectedScreenshotIndex
                        ? "bg-blue-600 text-white"
                        : "bg-surface-raised text-text-secondary hover:bg-zinc-700 border border-border-default"
                    }`}
                  >
                    {screenshot.name}
                  </button>
                ))}
              </div>
              <div className="flex-1 border border-border-default rounded bg-surface-raised overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedScreenshot.url}
                  alt={selectedScreenshot.name}
                  className="max-w-full h-auto"
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Camera className="w-12 h-12 mx-auto mb-2" />
                <p>Select screenshots to preview</p>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="processed" className="flex-1 mt-4">
          {result ? (
            <div className="h-full flex flex-col">
              <div
                className="flex-1 border border-border-default rounded overflow-auto p-4"
                style={CHECKERBOARD_STYLE}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.maskedScreenshots[selectedScreenshotIndex]}
                  alt="Processed"
                  className="max-w-full h-auto"
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <p>Process screenshots to see results</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="comparison" className="flex-1 mt-4">
          {result ? (
            <div className="h-full grid grid-cols-2 gap-4">
              <div className="border border-border-default rounded bg-surface-raised overflow-auto">
                <div className="p-2 bg-surface-raised font-semibold text-sm text-white border-b border-border-default">
                  Original
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedScreenshot?.url}
                  alt="Original"
                  className="max-w-full h-auto"
                />
              </div>
              <div
                className="border border-border-default rounded overflow-auto"
                style={CHECKERBOARD_STYLE}
              >
                <div className="p-2 bg-surface-raised font-semibold text-sm text-white border-b border-border-default">
                  Processed
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.maskedScreenshots[selectedScreenshotIndex]}
                  alt="Processed"
                  className="max-w-full h-auto"
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <p>Process screenshots to compare</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
