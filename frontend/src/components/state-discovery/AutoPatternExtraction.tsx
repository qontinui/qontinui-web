/**
 * Auto Pattern Extraction Component
 * EXPERIMENTAL: Computer Vision-powered pattern extraction using OpenCV
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sparkles,
  Loader2,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { prepareStateImageCreation } from "@/lib/state-image-creator";
import {
  createImageAsset,
  imageExistsInLibrary,
} from "@/lib/image-library-utils";
import { toast } from "sonner";

interface AutoPatternExtractionProps {
  onSuccess?: () => void;
  screenshots?: File[];
}

interface DetectedPattern {
  region: { x: number; y: number; w: number; h: number };
  confidence: number;
  pattern_type: string;
  suggested_name: string;
  image_data: string;
  source_screenshot: string;
}

export const AutoPatternExtraction: React.FC<AutoPatternExtractionProps> = ({
  onSuccess,
  screenshots,
}) => {
  const [stateName, setStateName] = useState("");
  const [screenshotPaths, setScreenshotPaths] = useState<string>("");
  const [detectButtons, setDetectButtons] = useState(true);
  const [detectInputs, setDetectInputs] = useState(true);
  const [detectIcons, setDetectIcons] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0.7);
  const [isExtracting, setIsExtracting] = useState(false);
  const [detectedPatterns, setDetectedPatterns] = useState<DetectedPattern[]>(
    []
  );
  const [selectedPatterns, setSelectedPatterns] = useState<Set<string>>(
    new Set()
  );

  const { states, addState, updateState, images, addImage } = useAutomation();

  const handleExtract = async () => {
    if (!stateName.trim()) {
      toast.error("Please enter a state name");
      return;
    }

    if (!screenshotPaths.trim()) {
      toast.error("Please enter screenshot paths");
      return;
    }

    if (!detectButtons && !detectInputs && !detectIcons) {
      toast.error("Please select at least one detection type");
      return;
    }

    setIsExtracting(true);
    setDetectedPatterns([]);
    setSelectedPatterns(new Set());

    try {
      // Split screenshot paths by newline or comma
      const paths = screenshotPaths
        .split(/[\n,]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (paths.length === 0) {
        toast.error("No valid screenshot paths provided");
        setIsExtracting(false);
        return;
      }

      const response = await fetch(
        "/api/integration-testing/patterns/auto-extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state_name: stateName,
            screenshot_paths: paths,
            snapshot_ids: [],
            detect_buttons: detectButtons,
            detect_inputs: detectInputs,
            detect_icons: detectIcons,
            min_confidence: minConfidence,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Extraction failed");
      }

      const data = await response.json();
      setDetectedPatterns(data.patterns);

      // Auto-select high confidence patterns
      const autoSelected = data.patterns
        .filter((p: DetectedPattern) => p.confidence >= 0.8)
        .map((p: DetectedPattern) => p.suggested_name);
      setSelectedPatterns(new Set(autoSelected));

      toast.success(
        `Detected ${data.total_detected} patterns from ${data.total_screenshots} screenshots`
      );
    } catch (error) {
      console.error("Extraction failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to extract patterns"
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleTogglePattern = (name: string) => {
    const newSelection = new Set(selectedPatterns);
    if (newSelection.has(name)) {
      newSelection.delete(name);
    } else {
      newSelection.add(name);
    }
    setSelectedPatterns(newSelection);
  };

  const handleSaveSelected = async () => {
    if (selectedPatterns.size === 0) {
      toast.error("Please select at least one pattern");
      return;
    }

    try {
      let addedCount = 0;
      const patternsToSave = detectedPatterns.filter((p) =>
        selectedPatterns.has(p.suggested_name)
      );

      for (const pattern of patternsToSave) {
        // Add to Image Library if not already exists
        if (!imageExistsInLibrary(images, pattern.image_data)) {
          const imageAsset = createImageAsset(
            pattern.image_data,
            pattern.suggested_name,
            "auto_extraction"
          );
          addImage(imageAsset);
          addedCount++;
        }
      }

      toast.success(`Added ${addedCount} patterns to Image Library`);

      if (onSuccess) {
        onSuccess();
      }

      // Reset selections
      setSelectedPatterns(new Set());
    } catch (error) {
      console.error("Failed to save patterns:", error);
      toast.error("Failed to save patterns");
    }
  };

  return (
    <div className="space-y-4">
      {/* Experimental Warning */}
      <Alert className="border-yellow-500 bg-yellow-50">
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
        <AlertDescription className="text-yellow-900">
          <strong>EXPERIMENTAL FEATURE:</strong> Computer vision-based pattern
          detection using OpenCV. Accuracy may vary depending on screenshot
          quality and UI design.
        </AlertDescription>
      </Alert>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Auto-Extract Patterns
            <Badge variant="outline" className="ml-2">
              EXPERIMENTAL
            </Badge>
          </CardTitle>
          <CardDescription>
            Uses computer vision to automatically detect UI elements like
            buttons, inputs, and icons
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* State Name */}
          <div className="space-y-2">
            <Label>State Name</Label>
            <Input
              type="text"
              placeholder="e.g., LoginPage, Dashboard"
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
            />
            <p className="text-xs text-gray-600">
              Used for naming detected patterns
            </p>
          </div>

          {/* Screenshot Paths */}
          <div className="space-y-2">
            <Label>Screenshot Paths</Label>
            <textarea
              className="w-full min-h-[100px] p-2 text-sm border rounded-md font-mono"
              placeholder={`Enter screenshot paths (one per line or comma-separated):\n/path/to/screenshot1.png\n/path/to/screenshot2.png`}
              value={screenshotPaths}
              onChange={(e) => setScreenshotPaths(e.target.value)}
            />
            <p className="text-xs text-gray-600">
              Absolute paths to screenshot files on the server
            </p>
          </div>

          {/* Detection Types */}
          <div className="space-y-2">
            <Label>Detection Types</Label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="detect-buttons"
                  checked={detectButtons}
                  onCheckedChange={(checked) =>
                    setDetectButtons(checked as boolean)
                  }
                />
                <label
                  htmlFor="detect-buttons"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Detect Buttons
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="detect-inputs"
                  checked={detectInputs}
                  onCheckedChange={(checked) =>
                    setDetectInputs(checked as boolean)
                  }
                />
                <label
                  htmlFor="detect-inputs"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Detect Input Fields
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="detect-icons"
                  checked={detectIcons}
                  onCheckedChange={(checked) =>
                    setDetectIcons(checked as boolean)
                  }
                />
                <label
                  htmlFor="detect-icons"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Detect Icons
                </label>
              </div>
            </div>
          </div>

          {/* Confidence Threshold */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Min Confidence Threshold</Label>
              <span className="text-sm text-gray-600">
                {(minConfidence * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[minConfidence]}
              onValueChange={([value]) => setMinConfidence(value)}
              min={0.5}
              max={1}
              step={0.05}
              className="w-full"
            />
            <p className="text-xs text-gray-600">
              Minimum confidence level for detected patterns
            </p>
          </div>

          <Button
            onClick={handleExtract}
            disabled={isExtracting}
            className="w-full"
          >
            {isExtracting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Extracting Patterns...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Start Auto-Extraction
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {detectedPatterns.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Detected Patterns ({detectedPatterns.length})
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  {selectedPatterns.size} selected
                </span>
                <Button
                  onClick={handleSaveSelected}
                  disabled={selectedPatterns.size === 0}
                  size="sm"
                >
                  Save Selected ({selectedPatterns.size})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {detectedPatterns.map((pattern, index) => (
                <div
                  key={index}
                  className={`p-2 border rounded cursor-pointer transition-all ${
                    selectedPatterns.has(pattern.suggested_name)
                      ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                  onClick={() => handleTogglePattern(pattern.suggested_name)}
                >
                  <div className="aspect-square bg-gray-100 rounded mb-2 overflow-hidden flex items-center justify-center">
                    {pattern.image_data ? (
                      <img
                        src={pattern.image_data}
                        alt={pattern.suggested_name}
                        className="max-w-full max-h-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-gray-400" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div
                      className="text-xs font-medium truncate"
                      title={pattern.suggested_name}
                    >
                      {pattern.suggested_name}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <Badge variant="outline" className="text-xs px-1">
                        {pattern.pattern_type}
                      </Badge>
                      <span
                        className={`font-medium ${
                          pattern.confidence >= 0.8
                            ? "text-green-600"
                            : pattern.confidence >= 0.6
                              ? "text-yellow-600"
                              : "text-red-600"
                        }`}
                      >
                        {(pattern.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div
                      className="text-xs text-gray-500 truncate"
                      title={
                        pattern.region
                          ? `${pattern.region.w}x${pattern.region.h}`
                          : ""
                      }
                    >
                      {pattern.region &&
                        `${pattern.region.w}x${pattern.region.h}px`}
                    </div>
                  </div>
                  {selectedPatterns.has(pattern.suggested_name) && (
                    <div className="absolute top-1 right-1">
                      <CheckCircle className="h-4 w-4 text-blue-600" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <h4 className="text-sm font-semibold mb-2">How to use:</h4>
          <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
            <li>Enter a state name for pattern naming</li>
            <li>Provide screenshot file paths (from server filesystem)</li>
            <li>Select which pattern types to detect</li>
            <li>Adjust confidence threshold</li>
            <li>Click "Start Auto-Extraction"</li>
            <li>Review detected patterns</li>
            <li>Select patterns and save to Image Library</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};
