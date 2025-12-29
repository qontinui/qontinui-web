/**
 * State Details Component
 * Shows details about a discovered state
 */

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Image as ImageIcon,
  Camera,
  Info,
  Edit,
  Eye,
  EyeOff,
  HelpCircle,
} from "lucide-react";
import { DiscoveredState, StateImage } from "@/types/stateDiscovery";
import { generateStateImageThumbnail } from "@/lib/imageUtils";

interface StateDetailsProps {
  state: DiscoveredState;
  stateImages: StateImage[];
  screenshots: File[];
  currentScreenshotIndex: number;
  onSelectScreenshot: (index: number) => void;
  onHighlightStateImages?: (stateImageIds: string[]) => void; // Optional for backward compatibility
}

const StateDetails: React.FC<StateDetailsProps> = ({
  state,
  stateImages,
  screenshots,
  currentScreenshotIndex,
  onSelectScreenshot,
  onHighlightStateImages,
}) => {
  const [showAllStateImages, setShowAllStateImages] = useState(false);
  const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});

  // Get the StateImage objects for this state (moved before useEffect)
  const stateImageObjects = state
    ? stateImages.filter((si) => state.stateImageIds?.includes(si.id))
    : [];

  // Generate thumbnails for state images
  useEffect(() => {
    if (!state) return;

    const generateThumbnails = async () => {
      const newThumbnails: { [key: string]: string } = {};

      for (const stateImage of stateImageObjects) {
        const thumbnail = await generateStateImageThumbnail(
          stateImage,
          screenshots,
          currentScreenshotIndex
        );
        if (thumbnail) {
          newThumbnails[stateImage.id] = thumbnail;
        }
      }

      setThumbnails(newThumbnails);
    };

    if (stateImageObjects.length > 0 && screenshots.length > 0) {
      generateThumbnails();
    }
  }, [state, stateImageObjects, screenshots, currentScreenshotIndex]);

  if (!state) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <div className="text-center">
          <Info className="mx-auto h-12 w-12 mb-2" />
          <p>Select a state to view details</p>
        </div>
      </div>
    );
  }

  // Handle screenshot click to show that screenshot
  const handleScreenshotClick = (screenshotId: string) => {
    // Find the actual index of this screenshot in the main screenshots array
    // Extract the index from screenshotId (e.g., "screenshot_001" -> 1)
    const match = screenshotId.match(/screenshot_(\d+)/);
    let actualScreenshotIndex = 0;

    if (match) {
      actualScreenshotIndex = parseInt(match[1] ?? "0", 10);
    } else {
      console.warn("Could not extract index from screenshotId:", screenshotId);
    }

    // Switch to the correct screenshot
    onSelectScreenshot(actualScreenshotIndex);
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col space-y-4">
        {/* State Header */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span>{state.name}</span>
              <Button size="sm" variant="ghost">
                <Edit className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Confidence Score */}
            <div className="flex items-center justify-between">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-gray-600 flex items-center gap-1 cursor-help">
                    Confidence Score
                    <HelpCircle className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">
                    The confidence score indicates how reliably this state can
                    be identified. It&apos;s calculated based on:
                  </p>
                  <ul className="text-xs mt-1 space-y-0.5">
                    <li>• Consistency of state images across screenshots</li>
                    <li>• Pixel stability in identified regions</li>
                    <li>• Co-occurrence patterns with other state images</li>
                    <li>• Frequency of appearance in the screenshot set</li>
                  </ul>
                  <p className="text-xs mt-1">
                    Higher scores (80%+) indicate more reliable state detection.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Badge variant={state.confidence > 0.8 ? "default" : "secondary"}>
                {(state.confidence * 100).toFixed(1)}%
              </Badge>
            </div>

            {/* State ID */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">ID</span>
              <span className="text-xs font-mono">{state.id}</span>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="text-center p-2 bg-gray-50 rounded">
                <p className="text-lg font-semibold">
                  {state.stateImageIds?.length || 0}
                </p>
                <p className="text-xs text-gray-600">StateImages</p>
              </div>
              <div className="text-center p-2 bg-gray-50 rounded">
                <p className="text-lg font-semibold">
                  {state.screenshotIds?.length || 0}
                </p>
                <p className="text-xs text-gray-600">Screenshots</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabbed Content */}
        <Tabs defaultValue="stateimages" className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger
              value="stateimages"
              className="flex items-center gap-1"
            >
              <ImageIcon className="mr-1 h-4 w-4" />
              <span>StateImages</span>
              <span className="ml-1 text-gray-600">
                ({stateImageObjects.length})
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="screenshots"
              className="flex items-center gap-1"
            >
              <Camera className="mr-1 h-4 w-4" />
              <span>Screenshots</span>
              <span className="ml-1 text-gray-600">
                ({state.screenshotIds?.length || 0})
              </span>
            </TabsTrigger>
          </TabsList>

          {/* StateImages Tab */}
          <TabsContent value="stateimages" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">StateImages</CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAllStateImages(!showAllStateImages)}
                  >
                    {showAllStateImages ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {stateImageObjects.map((stateImage) => (
                      <div
                        key={stateImage.id}
                        className="p-2 border rounded hover:bg-gray-50 cursor-pointer"
                        onClick={() =>
                          onHighlightStateImages?.([stateImage.id])
                        }
                      >
                        <div className="flex gap-3">
                          {/* Thumbnail */}
                          {thumbnails[stateImage.id] && (
                            <div className="flex-shrink-0">
                              <img
                                src={thumbnails[stateImage.id]}
                                alt={stateImage.name}
                                className="w-16 h-16 object-contain border rounded"
                                style={{ imageRendering: "pixelated" }}
                              />
                            </div>
                          )}

                          {/* Info */}
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {stateImage.name}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {stateImage.x},{stateImage.y}
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              Size: {stateImage.x2 - stateImage.x + 1} ×{" "}
                              {stateImage.y2 - stateImage.y + 1}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Frequency:{" "}
                              {((stateImage.frequency ?? 0) * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Screenshots Tab */}
          <TabsContent value="screenshots" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Screenshots ({state.screenshotIds?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {(state.screenshotIds || []).map((screenshotId, index) => (
                      <div
                        key={screenshotId}
                        className="p-3 border rounded hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => handleScreenshotClick(screenshotId)}
                      >
                        <div className="flex items-center">
                          <Camera className="h-4 w-4 mr-2 text-gray-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">
                              Screenshot {index + 1}
                            </p>
                            <p className="text-xs text-gray-600 font-mono break-all">
                              {screenshotId}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Info Message */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="w-4 h-4 bg-yellow-500 border border-yellow-600 rounded-sm"></div>
              <span>StateImages in this state are highlighted in yellow</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
};

export default StateDetails;
