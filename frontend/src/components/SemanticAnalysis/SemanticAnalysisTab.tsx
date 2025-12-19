"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Upload,
  Scan,
  Image as ImageIcon,
  RefreshCw,
  Info,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  SemanticObject,
  SemanticScene,
  ProcessingOptions,
  SemanticProcessResponse,
} from "@/types/semantic-analysis";

export function SemanticAnalysisTab() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [scene, setScene] = useState<SemanticScene | null>(null);
  const [selectedObject, setSelectedObject] = useState<SemanticObject | null>(
    null
  );
  const [hoveredObject, setHoveredObject] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [showMasks, setShowMasks] = useState(false);
  const [confidence, setConfidence] = useState(0.7);
  const [enableOCR, setEnableOCR] = useState(true);
  const [descriptionModel, setDescriptionModel] = useState<"clip" | "basic">(
    "clip"
  );
  const [strategy, setStrategy] = useState<"sam2" | "sam3" | "ocr" | "hybrid">(
    "hybrid"
  );
  const [textPrompt, setTextPrompt] = useState("");
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Object type colors
  const typeColors: Record<string, string> = {
    button: "#00D9FF",
    input: "#00FF88",
    label: "#FFD700",
    image: "#BD00FF",
    checkbox: "#FF6B6B",
    default: "#808080",
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setSelectedImage(result);
      setScene(null);
      setSelectedObject(null);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async () => {
    if (!selectedImage) {
      toast.error("Please upload an image first");
      return;
    }

    setProcessing(true);
    try {
      const options: ProcessingOptions = {
        enable_ocr: enableOCR,
        min_confidence: confidence,
        description_model: descriptionModel,
      };

      const requestBody: {
        image: string;
        strategy: string;
        options: unknown;
        text_prompt?: string;
      } = {
        image: selectedImage,
        strategy,
        options,
      };

      // Only include text_prompt if it&apos;s not empty and strategy is sam3
      if (textPrompt.trim() && strategy === "sam3") {
        requestBody.text_prompt = textPrompt.trim();
      }

      const response = await fetch(
        "http://localhost:8000/api/semantic/process",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data: SemanticProcessResponse = await response.json();
      setScene(data.scene);
      toast.success(
        `Detected ${data.scene.object_count} objects in ${data.processing_time_ms.toFixed(0)}ms`
      );
    } catch (error) {
      console.error("Processing error:", error);
      toast.error("Failed to process image");
    } finally {
      setProcessing(false);
    }
  };

  // Draw visualization on canvas
  useEffect(() => {
    if (!canvasRef.current || !selectedImage || !scene) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas size
      canvas.width = img.width;
      canvas.height = img.height;

      // Clear and draw image
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Draw objects
      scene.objects.forEach((obj) => {
        const isHovered = hoveredObject === obj.id;
        const isSelected = selectedObject?.id === obj.id;
        const color = typeColors[obj.type] ?? typeColors.default ?? "#808080";

        // Draw bounding box
        if (showBoundingBoxes) {
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1;

          // Add glow effect for selected objects with masks
          if (isSelected && obj.pixel_mask) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
          }

          ctx.strokeRect(
            obj.bounding_box.x,
            obj.bounding_box.y,
            obj.bounding_box.width,
            obj.bounding_box.height
          );

          // Reset shadow
          ctx.shadowBlur = 0;

          // Draw corner markers for selected
          if (isSelected) {
            const corners = [
              { x: obj.bounding_box.x, y: obj.bounding_box.y },
              {
                x: obj.bounding_box.x + obj.bounding_box.width,
                y: obj.bounding_box.y,
              },
              {
                x: obj.bounding_box.x,
                y: obj.bounding_box.y + obj.bounding_box.height,
              },
              {
                x: obj.bounding_box.x + obj.bounding_box.width,
                y: obj.bounding_box.y + obj.bounding_box.height,
              },
            ];
            corners.forEach((corner) => {
              ctx.fillStyle = color;
              ctx.fillRect(corner.x - 3, corner.y - 3, 6, 6);
            });

            // Add mask indicator for objects with masks
            if (obj.pixel_mask) {
              ctx.fillStyle = color;
              ctx.font = "bold 10px sans-serif";
              ctx.fillText("M", obj.bounding_box.x + 2, obj.bounding_box.y - 5);
            }
          }
        }

        // Draw pixel mask if available
        if (showMasks && obj.pixel_mask) {
          try {
            // Create a temporary image to decode the mask
            const maskImg = new Image();
            maskImg.onload = () => {
              // Save current composite operation
              const prevComposite = ctx.globalCompositeOperation;
              const prevAlpha = ctx.globalAlpha;

              // Set transparency for mask overlay
              ctx.globalAlpha = 0.3;

              // Create a temporary canvas for the mask
              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = obj.bounding_box.width;
              tempCanvas.height = obj.bounding_box.height;
              const tempCtx = tempCanvas.getContext("2d");

              if (tempCtx) {
                // Draw the mask onto temporary canvas
                tempCtx.drawImage(maskImg, 0, 0);

                // Get mask data and colorize it
                const imageData = tempCtx.getImageData(
                  0,
                  0,
                  tempCanvas.width,
                  tempCanvas.height
                );
                const data = imageData.data;

                // Parse color (remove # if present)
                const hexColor = (color ?? "#808080").replace("#", "");
                const r = parseInt(hexColor.substr(0, 2), 16);
                const g = parseInt(hexColor.substr(2, 2), 16);
                const b = parseInt(hexColor.substr(4, 2), 16);

                // Colorize the mask
                for (let i = 0; i < data.length; i += 4) {
                  const val0 = data[i];
                  const val1 = data[i + 1];
                  const val2 = data[i + 2];
                  if (
                    val0 !== undefined &&
                    val1 !== undefined &&
                    val2 !== undefined
                  ) {
                    if (val0 > 0 || val1 > 0 || val2 > 0) {
                      data[i] = r; // Red
                      data[i + 1] = g; // Green
                      data[i + 2] = b; // Blue
                      data[i + 3] = 200; // Alpha (semi-transparent)
                    }
                  }
                }

                tempCtx.putImageData(imageData, 0, 0);

                // Draw the colorized mask onto the main canvas
                ctx.drawImage(
                  tempCanvas,
                  obj.bounding_box.x,
                  obj.bounding_box.y
                );
              }

              // Restore previous settings
              ctx.globalCompositeOperation = prevComposite;
              ctx.globalAlpha = prevAlpha;
            };

            // Handle base64 encoded mask
            if (!obj.pixel_mask.startsWith("data:")) {
              maskImg.src = `data:image/png;base64,${obj.pixel_mask}`;
            } else {
              maskImg.src = obj.pixel_mask;
            }
          } catch (e) {
            console.error("Error drawing mask:", e);
            // Fallback to simple rectangle fill
            ctx.fillStyle = color + "33";
            ctx.fillRect(
              obj.bounding_box.x,
              obj.bounding_box.y,
              obj.bounding_box.width,
              obj.bounding_box.height
            );
          }
        }

        // Draw labels
        if (showLabels && (isHovered || isSelected)) {
          const label = obj.ocr_text || obj.type;
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(
            obj.bounding_box.x,
            obj.bounding_box.y - 20,
            ctx.measureText(label).width + 8,
            20
          );
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "12px sans-serif";
          ctx.fillText(label, obj.bounding_box.x + 4, obj.bounding_box.y - 6);
        }
      });
    };
    img.src = selectedImage;
  }, [
    selectedImage,
    scene,
    hoveredObject,
    selectedObject,
    showLabels,
    showBoundingBoxes,
    showMasks,
  ]);

  // Handle canvas click to select object
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!scene || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - panOffset.x;
    const y = (e.clientY - rect.top) / zoom - panOffset.y;

    // Find clicked object
    const clickedObject = scene.objects.find(
      (obj) =>
        x >= obj.bounding_box.x &&
        x <= obj.bounding_box.x + obj.bounding_box.width &&
        y >= obj.bounding_box.y &&
        y <= obj.bounding_box.y + obj.bounding_box.height
    );

    setSelectedObject(clickedObject || null);
  };

  // Handle canvas hover
  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!scene || !canvasRef.current) return;

    if (isDragging) {
      setPanOffset({
        x: panOffset.x + (e.clientX - dragStart.x) / zoom,
        y: panOffset.y + (e.clientY - dragStart.y) / zoom,
      });
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - panOffset.x;
    const y = (e.clientY - rect.top) / zoom - panOffset.y;

    // Find hovered object
    const hoveredObj = scene.objects.find(
      (obj) =>
        x >= obj.bounding_box.x &&
        x <= obj.bounding_box.x + obj.bounding_box.width &&
        y >= obj.bounding_box.y &&
        y <= obj.bounding_box.y + obj.bounding_box.height
    );

    setHoveredObject(hoveredObj?.id || null);
  };

  return (
    <div className="h-full flex bg-[#0A0A0B]">
      {/* Left Panel - Controls */}
      <div className="w-80 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          {/* Image Upload */}
          <Card className="bg-[#27272A]/50 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Image Upload</CardTitle>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full border-gray-700 hover:border-[#00D9FF]"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Screenshot
              </Button>
              {selectedImage && (
                <div className="mt-2 text-xs text-gray-400">
                  Image loaded and ready for analysis
                </div>
              )}
            </CardContent>
          </Card>

          {/* Processing Options */}
          <Card className="bg-[#27272A]/50 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Processing Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs">Detection Strategy</Label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <Button
                    size="sm"
                    variant={strategy === "sam2" ? "default" : "outline"}
                    onClick={() => setStrategy("sam2")}
                    className="text-xs"
                    title="Segment Anything Model v2 - generates pixel-perfect masks"
                  >
                    SAM2
                  </Button>
                  <Button
                    size="sm"
                    variant={strategy === "sam3" ? "default" : "outline"}
                    onClick={() => setStrategy("sam3")}
                    className="text-xs"
                    title="Segment Anything Model v3 - text-prompted segmentation"
                  >
                    SAM3
                  </Button>
                  <Button
                    size="sm"
                    variant={strategy === "ocr" ? "default" : "outline"}
                    onClick={() => setStrategy("ocr")}
                    className="text-xs"
                    title="Optical Character Recognition - focuses on text extraction"
                  >
                    OCR
                  </Button>
                  <Button
                    size="sm"
                    variant={strategy === "hybrid" ? "default" : "outline"}
                    onClick={() => setStrategy("hybrid")}
                    className="text-xs"
                    title="Combined approach using both segmentation and text detection"
                  >
                    Hybrid
                  </Button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 leading-tight">
                  {strategy === "sam2"
                    ? "Segmentation with masks"
                    : strategy === "sam3"
                      ? "Text-prompted segmentation"
                      : strategy === "ocr"
                        ? "Text extraction only"
                        : "Combined detection"}
                </p>
              </div>

              {/* SAM3 Text Prompt Controls */}
              {strategy === "sam3" && (
                <div className="space-y-3 p-3 border border-[#00D9FF]/30 rounded-md bg-[#00D9FF]/5">
                  <div>
                    <Label className="text-xs">Text Prompt (optional)</Label>
                    <Input
                      value={textPrompt}
                      onChange={(e) => setTextPrompt(e.target.value)}
                      placeholder="e.g., button, icon, text field..."
                      className="mt-1 text-xs h-8 bg-[#27272A] border-gray-700 focus:border-[#00D9FF]"
                    />
                    <p className="text-[10px] text-gray-400 mt-1 leading-tight">
                      Describe what you want to detect
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs mb-2 block">Quick Presets</Label>
                    <div className="flex flex-wrap gap-1">
                      {[
                        "Everything",
                        "Button",
                        "Icon",
                        "Text Field",
                        "Checkbox",
                        "Link",
                        "Menu Item",
                      ].map((preset) => (
                        <Button
                          key={preset}
                          size="sm"
                          variant={
                            textPrompt === preset.toLowerCase()
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setTextPrompt(preset.toLowerCase())}
                          className="text-xs h-6 px-2"
                        >
                          {preset}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs">Description Model</Label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <Button
                    size="sm"
                    variant={
                      descriptionModel === "clip" ? "default" : "outline"
                    }
                    onClick={() => setDescriptionModel("clip")}
                    className="text-xs"
                    title="AI-powered vision-language model for semantic descriptions"
                  >
                    CLIP
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      descriptionModel === "basic" ? "default" : "outline"
                    }
                    onClick={() => setDescriptionModel("basic")}
                    className="text-xs"
                    title="Rule-based detection using OpenCV computer vision"
                  >
                    OpenCV
                  </Button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 leading-tight">
                  {descriptionModel === "clip"
                    ? "AI semantic descriptions"
                    : "Rule-based CV detection"}
                </p>
              </div>

              <div>
                <Label className="text-xs">
                  Min Confidence: {confidence.toFixed(2)}
                </Label>
                <Slider
                  value={[confidence]}
                  onValueChange={([v]) => setConfidence(v ?? 0)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="mt-1"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs">Enable OCR</Label>
                <Switch checked={enableOCR} onCheckedChange={setEnableOCR} />
              </div>

              <Button
                onClick={processImage}
                disabled={!selectedImage || processing}
                className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
              >
                {processing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Scan className="w-4 h-4 mr-2" />
                    Analyze Image
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Display Options */}
          <Card className="bg-[#27272A]/50 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Display Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show Labels</Label>
                <Switch checked={showLabels} onCheckedChange={setShowLabels} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show Bounding Boxes</Label>
                <Switch
                  checked={showBoundingBoxes}
                  onCheckedChange={setShowBoundingBoxes}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show Masks</Label>
                <Switch checked={showMasks} onCheckedChange={setShowMasks} />
              </div>
            </CardContent>
          </Card>

          {/* Statistics */}
          {scene && (
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Analysis Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Total Objects</span>
                  <span className="font-bold">{scene.object_count}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Timestamp</span>
                  <span>{new Date(scene.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="space-y-1 mt-3">
                  {Object.entries(
                    scene.objects.reduce(
                      (acc, obj) => {
                        acc[obj.type] = (acc[obj.type] || 0) + 1;
                        return acc;
                      },
                      {} as Record<string, number>
                    )
                  ).map(([type, count]) => (
                    <div key={type} className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded"
                          style={{
                            backgroundColor:
                              typeColors[type] || typeColors.default,
                          }}
                        />
                        <span className="capitalize">{type}</span>
                      </div>
                      <span>{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Center - Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="border-b border-gray-800 p-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setZoom(Math.min(zoom * 1.2, 5))}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setZoom(Math.max(zoom * 0.8, 0.5))}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setZoom(1);
                setPanOffset({ x: 0, y: 0 });
              }}
            >
              Reset
            </Button>
            <span className="text-xs text-gray-400 ml-2">
              Zoom: {(zoom * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Canvas Container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-gray-900 relative"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          {selectedImage ? (
            <div
              style={{
                transform: `scale(${zoom}) translate(${panOffset.x}px, ${panOffset.y}px)`,
                transformOrigin: "top left",
              }}
            >
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMove}
                onMouseLeave={() => setHoveredObject(null)}
                onMouseDown={(e) => {
                  if (e.shiftKey) {
                    setIsDragging(true);
                    setDragStart({ x: e.clientX, y: e.clientY });
                  }
                }}
                onMouseUp={() => setIsDragging(false)}
                className="max-w-full"
                style={{
                  cursor: hoveredObject
                    ? "pointer"
                    : isDragging
                      ? "grabbing"
                      : "grab",
                }}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <ImageIcon className="w-12 h-12 mx-auto mb-2 text-gray-500" />
                <p className="text-sm text-gray-400">
                  Upload an image to begin semantic analysis
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Object Details */}
      <div className="w-96 border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        <h3 className="text-sm font-medium mb-4">Object Details</h3>

        {selectedObject ? (
          <div className="space-y-4">
            <Card className="bg-[#27272A]/50 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{selectedObject.type.toUpperCase()}</span>
                  <Badge
                    style={{
                      backgroundColor:
                        typeColors[selectedObject.type] || typeColors.default,
                    }}
                  >
                    {(selectedObject.confidence * 100).toFixed(0)}%
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-400">Description</Label>
                  <p className="text-sm mt-1">{selectedObject.description}</p>
                </div>

                {selectedObject.ocr_text && (
                  <div>
                    <Label className="text-xs text-gray-400">OCR Text</Label>
                    <p className="text-sm mt-1 font-mono">
                      {selectedObject.ocr_text}
                    </p>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-gray-400">Position</Label>
                  <p className="text-xs mt-1 font-mono">
                    x: {selectedObject.bounding_box.x}, y:{" "}
                    {selectedObject.bounding_box.y}
                  </p>
                  <p className="text-xs font-mono">
                    w: {selectedObject.bounding_box.width}, h:{" "}
                    {selectedObject.bounding_box.height}
                  </p>
                </div>

                <div>
                  <Label className="text-xs text-gray-400">Attributes</Label>
                  <div className="mt-1 space-y-1">
                    {Object.entries(selectedObject.attributes).map(
                      ([key, value]) => (
                        <div key={key} className="flex justify-between text-xs">
                          <span className="text-gray-400">{key}:</span>
                          <span
                            className={
                              key === "has_mask" && value
                                ? "text-green-400"
                                : ""
                            }
                          >
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {selectedObject.pixel_mask && (
                  <div className="pt-3 border-t border-gray-700">
                    <Label className="text-xs text-gray-400">
                      Mask Information
                    </Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400"></div>
                        <span className="text-xs">Pixel mask available</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        Mask size: {selectedObject.bounding_box.width} ×{" "}
                        {selectedObject.bounding_box.height}
                      </div>
                      <div className="text-xs text-gray-400">
                        Area:{" "}
                        {(selectedObject.attributes as { area?: number }).area ||
                          selectedObject.bounding_box.width *
                            selectedObject.bounding_box.height}{" "}
                        px²
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => {
                      // Scroll to the object in the canvas
                      if (canvasRef.current) {
                        const rect = canvasRef.current.getBoundingClientRect();
                        const x =
                          selectedObject.bounding_box.x +
                          selectedObject.bounding_box.width / 2;
                        const y =
                          selectedObject.bounding_box.y +
                          selectedObject.bounding_box.height / 2;

                        setPanOffset({
                          x: -x + rect.width / (2 * zoom),
                          y: -y + rect.height / (2 * zoom),
                        });
                      }
                    }}
                  >
                    Center in View
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : scene ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 mb-3">
              Click on an object in the image to see details
            </p>

            {/* Object List */}
            <div className="space-y-1">
              {scene.objects.map((obj) => (
                <div
                  key={obj.id}
                  onClick={() => setSelectedObject(obj)}
                  onMouseEnter={() => setHoveredObject(obj.id)}
                  onMouseLeave={() => setHoveredObject(null)}
                  className={cn(
                    "p-2 rounded border cursor-pointer transition-all",
                    hoveredObject === obj.id
                      ? "border-[#00D9FF] bg-[#00D9FF]/10"
                      : "border-gray-700 hover:border-gray-600"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{
                          backgroundColor:
                            typeColors[obj.type] || typeColors.default,
                        }}
                      />
                      <span className="text-xs capitalize">{obj.type}</span>
                      {obj.pixel_mask && (
                        <Badge
                          variant="outline"
                          className="text-xs px-1 py-0 h-4"
                        >
                          M
                        </Badge>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {(obj.confidence * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  {obj.ocr_text && (
                    <p className="text-xs text-gray-400 mt-1 truncate">
                      {obj.ocr_text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <Info className="w-8 h-8 mx-auto mb-2 text-gray-500" />
            <p className="text-xs text-gray-400">
              Process an image to see detected objects
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
