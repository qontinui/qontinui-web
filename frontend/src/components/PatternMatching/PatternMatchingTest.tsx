/**
 * Pattern Matching Test Component
 *
 * Interactive tool for testing pattern matching via the runner's Python bridge.
 * Allows uploading screenshots and templates, configuring similarity thresholds,
 * and visualizing match results with bounding boxes.
 */

import React, { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  Camera,
  Loader2,
  Search,
  Trash2,
  Settings,
  Target,
  CheckCircle,
  XCircle,
  Image as ImageIcon,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  runnerClient,
  type PatternMatch,
  type PatternMatchResponse,
} from "@/lib/runner-client";

interface PatternMatchingTestProps {
  className?: string;
}

export const PatternMatchingTest: React.FC<PatternMatchingTestProps> = ({
  className,
}) => {
  // Image state
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(
    null
  );
  const [templateDataUrl, setTemplateDataUrl] = useState<string | null>(null);
  const [screenshotDimensions, setScreenshotDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [templateDimensions, setTemplateDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Configuration state
  const [similarity, setSimilarity] = useState(0.8);
  const [findAll, setFindAll] = useState(false);
  const [maxMatches, setMaxMatches] = useState(100);

  // Results state
  const [isSearching, setIsSearching] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [results, setResults] = useState<PatternMatchResponse | null>(null);

  // Refs
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Handle file upload
  const handleFileUpload = useCallback(
    (
      event: React.ChangeEvent<HTMLInputElement>,
      setDataUrl: (url: string) => void,
      setDimensions: (dims: { width: number; height: number }) => void
    ) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setDataUrl(dataUrl);

        // Get image dimensions
        const img = new Image();
        img.onload = () => {
          setDimensions({ width: img.width, height: img.height });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    []
  );

  // Capture screenshot from runner
  const handleCaptureScreenshot = useCallback(async () => {
    setIsCapturing(true);
    try {
      const response = await runnerClient.captureScreenshot();
      if (response.success && response.screenshot_base64) {
        const dataUrl = `data:image/png;base64,${response.screenshot_base64}`;
        setScreenshotDataUrl(dataUrl);
        if (response.width && response.height) {
          setScreenshotDimensions({
            width: response.width,
            height: response.height,
          });
        }
        toast.success("Screenshot captured");
      } else {
        toast.error(response.error || "Failed to capture screenshot");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to capture screenshot"
      );
    } finally {
      setIsCapturing(false);
    }
  }, []);

  // Run pattern matching
  const handleSearch = useCallback(async () => {
    if (!screenshotDataUrl || !templateDataUrl) {
      toast.error("Please provide both screenshot and template images");
      return;
    }

    setIsSearching(true);
    setResults(null);

    try {
      // Extract base64 data from data URLs
      const screenshotBase64 = screenshotDataUrl.split(",")[1] ?? screenshotDataUrl;
      const templateBase64 = templateDataUrl.split(",")[1] ?? templateDataUrl;

      const response = findAll
        ? await runnerClient.patternFindAll({
            screenshot: screenshotBase64,
            template: templateBase64,
            similarity,
            max_matches: maxMatches,
          })
        : await runnerClient.patternFind({
            screenshot: screenshotBase64,
            template: templateBase64,
            similarity,
          });

      setResults(response);

      if (response.success) {
        if (response.matches.length > 0) {
          toast.success(
            `Found ${response.matches.length} match${response.matches.length !== 1 ? "es" : ""}`
          );
        } else {
          toast.info("No matches found above threshold");
        }
      } else {
        toast.error(response.error || "Pattern matching failed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Pattern matching failed"
      );
    } finally {
      setIsSearching(false);
    }
  }, [
    screenshotDataUrl,
    templateDataUrl,
    similarity,
    findAll,
    maxMatches,
  ]);

  // Clear all
  const handleClear = useCallback(() => {
    setScreenshotDataUrl(null);
    setTemplateDataUrl(null);
    setScreenshotDimensions(null);
    setTemplateDimensions(null);
    setResults(null);
    if (screenshotInputRef.current) screenshotInputRef.current.value = "";
    if (templateInputRef.current) templateInputRef.current.value = "";
  }, []);

  // Render match results on canvas
  const renderMatches = useCallback(
    (matches: PatternMatch[]) => {
      const canvas = canvasRef.current;
      if (!canvas || !screenshotDataUrl) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Draw match rectangles
        matches.forEach((match, index) => {
          // Draw rectangle
          ctx.strokeStyle = "#00ff00";
          ctx.lineWidth = 3;
          ctx.strokeRect(match.x, match.y, match.width, match.height);

          // Draw center point
          ctx.fillStyle = "#ff0000";
          ctx.beginPath();
          ctx.arc(match.center_x, match.center_y, 5, 0, 2 * Math.PI);
          ctx.fill();

          // Draw similarity label
          ctx.fillStyle = "#00ff00";
          ctx.font = "14px monospace";
          ctx.fillRect(match.x, match.y - 20, 80, 18);
          ctx.fillStyle = "#000000";
          ctx.fillText(
            `${(match.similarity * 100).toFixed(1)}%`,
            match.x + 4,
            match.y - 6
          );

          // Draw index for multiple matches
          if (matches.length > 1) {
            ctx.fillStyle = "#ff0000";
            ctx.fillRect(match.x + match.width - 20, match.y, 20, 18);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(
              `${index + 1}`,
              match.x + match.width - 15,
              match.y + 14
            );
          }
        });
      };
      img.src = screenshotDataUrl;
    },
    [screenshotDataUrl]
  );

  // Update canvas when results change
  React.useEffect(() => {
    if (results?.matches && results.matches.length > 0) {
      renderMatches(results.matches);
    }
  }, [results, renderMatches]);

  return (
    <div className={cn("flex flex-col h-full gap-4 p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Pattern Matching Test</h2>
          <p className="text-muted-foreground">
            Test template matching via the local runner
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleClear}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
          <Button
            onClick={handleSearch}
            disabled={!screenshotDataUrl || !templateDataUrl || isSearching}
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            {findAll ? "Find All" : "Find Best"}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-[350px_1fr] gap-4 min-h-0">
        {/* Left panel - inputs */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {/* Screenshot input */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Screenshot (Search Target)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => screenshotInputRef.current?.click()}
                  className="flex-1"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCaptureScreenshot}
                  disabled={isCapturing}
                  className="flex-1"
                >
                  {isCapturing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4 mr-2" />
                  )}
                  Capture
                </Button>
              </div>
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  handleFileUpload(
                    e,
                    setScreenshotDataUrl,
                    setScreenshotDimensions
                  )
                }
              />
              {screenshotDataUrl && (
                <div className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Base64 data URL cannot use Next.js Image optimization */}
                  <img
                    src={screenshotDataUrl}
                    alt="Screenshot"
                    className="w-full rounded border"
                  />
                  {screenshotDimensions && (
                    <Badge
                      variant="secondary"
                      className="absolute bottom-2 right-2"
                    >
                      {screenshotDimensions.width} x{" "}
                      {screenshotDimensions.height}
                    </Badge>
                  )}
                </div>
              )}
              {!screenshotDataUrl && (
                <div className="flex items-center justify-center h-32 border-2 border-dashed rounded-lg text-muted-foreground">
                  <span className="text-sm">No screenshot loaded</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Template input */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="w-4 h-4" />
                Template (Pattern to Find)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => templateInputRef.current?.click()}
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Template
              </Button>
              <input
                ref={templateInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  handleFileUpload(e, setTemplateDataUrl, setTemplateDimensions)
                }
              />
              {templateDataUrl && (
                <div className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Base64 data URL cannot use Next.js Image optimization */}
                  <img
                    src={templateDataUrl}
                    alt="Template"
                    className="w-full rounded border"
                  />
                  {templateDimensions && (
                    <Badge
                      variant="secondary"
                      className="absolute bottom-2 right-2"
                    >
                      {templateDimensions.width} x {templateDimensions.height}
                    </Badge>
                  )}
                </div>
              )}
              {!templateDataUrl && (
                <div className="flex items-center justify-center h-24 border-2 border-dashed rounded-lg text-muted-foreground">
                  <span className="text-sm">No template loaded</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Similarity threshold */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Similarity Threshold</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {(similarity * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[similarity]}
                  onValueChange={(values) => setSimilarity(values[0] ?? 0.8)}
                  min={0.5}
                  max={1.0}
                  step={0.05}
                />
                <p className="text-xs text-muted-foreground">
                  Higher values require closer matches
                </p>
              </div>

              {/* Find all toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Find All Matches</Label>
                  <p className="text-xs text-muted-foreground">
                    Find multiple occurrences
                  </p>
                </div>
                <Switch checked={findAll} onCheckedChange={setFindAll} />
              </div>

              {/* Max matches (when find all is enabled) */}
              {findAll && (
                <div className="space-y-2">
                  <Label className="text-sm">Max Matches</Label>
                  <Input
                    type="number"
                    value={maxMatches}
                    onChange={(e) => setMaxMatches(Number(e.target.value))}
                    min={1}
                    max={1000}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right panel - results */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-sm flex items-center gap-2">
              Results
              {results && (
                <Badge variant={results.success ? "default" : "destructive"}>
                  {results.success ? (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {results.matches.length} match
                      {results.matches.length !== 1 ? "es" : ""}
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 mr-1" />
                      Failed
                    </>
                  )}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto">
            {!results && !isSearching && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Search className="w-12 h-12 mb-4 opacity-20" />
                <p>Run a search to see results</p>
              </div>
            )}

            {isSearching && (
              <div className="flex flex-col items-center justify-center h-full">
                <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Searching...</p>
              </div>
            )}

            {results && !isSearching && (
              <Tabs defaultValue="visual" className="h-full flex flex-col">
                <TabsList className="shrink-0">
                  <TabsTrigger value="visual">Visual</TabsTrigger>
                  <TabsTrigger value="details">Details</TabsTrigger>
                </TabsList>

                <TabsContent
                  value="visual"
                  className="flex-1 overflow-auto mt-4"
                >
                  {results.matches.length > 0 ? (
                    <div className="relative">
                      <canvas
                        ref={canvasRef}
                        className="max-w-full h-auto border rounded"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <XCircle className="w-12 h-12 mb-4 opacity-20" />
                      <p>No matches found above {(similarity * 100).toFixed(0)}% threshold</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="details"
                  className="flex-1 overflow-auto mt-4"
                >
                  <div className="space-y-4">
                    {/* Search stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">
                          Search Time
                        </p>
                        <p className="text-lg font-mono">
                          {results.search_time_ms.toFixed(1)}ms
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">
                          Screenshot Size
                        </p>
                        <p className="text-lg font-mono">
                          {results.screenshot_width} x {results.screenshot_height}
                        </p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground">
                          Template Size
                        </p>
                        <p className="text-lg font-mono">
                          {results.template_width} x {results.template_height}
                        </p>
                      </div>
                    </div>

                    {/* Match list */}
                    {results.matches.length > 0 ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Matches</h4>
                        <div className="space-y-2">
                          {results.matches.map((match, index) => (
                            <div
                              key={index}
                              className="bg-muted/50 rounded-lg p-3"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium">
                                  Match #{index + 1}
                                </span>
                                <Badge
                                  variant={
                                    match.similarity > 0.9
                                      ? "default"
                                      : match.similarity > 0.8
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {(match.similarity * 100).toFixed(1)}%
                                </Badge>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <span className="text-muted-foreground">
                                    Position:{" "}
                                  </span>
                                  <span className="font-mono">
                                    ({match.x}, {match.y})
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Size:{" "}
                                  </span>
                                  <span className="font-mono">
                                    {match.width} x {match.height}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Center:{" "}
                                  </span>
                                  <span className="font-mono">
                                    ({match.center_x}, {match.center_y})
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        No matches found
                      </div>
                    )}

                    {/* Error display */}
                    {results.error && (
                      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                        <p className="text-sm text-destructive">
                          {results.error}
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info footer */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="w-4 h-4" />
        <span>
          Pattern matching uses OpenCV template matching (TM_CCOEFF_NORMED) via
          the local runner.
        </span>
      </div>
    </div>
  );
};

export default PatternMatchingTest;
