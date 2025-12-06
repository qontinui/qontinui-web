"use client";

import type React from "react";

import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Paintbrush,
  Eraser,
  Undo,
  Redo,
  Trash2,
  Save,
  X,
  Sparkles,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyBackgroundRemoval,
  applyBorderRemoval,
} from "@/lib/mask-processing";

interface MaskEditorProps {
  imageUrl: string;
  imageName?: string;
  initialMask?: string; // Base64 encoded mask image (PNG with alpha channel)
  onSave: (maskedImage: string, mask: string) => void;
  onCancel: () => void;
  open?: boolean;
}

type Tool = "brush" | "eraser";

interface HistoryState {
  maskData: ImageData;
}

export const MaskEditor: React.FC<MaskEditorProps> = ({
  imageUrl,
  imageName: imageNameProp,
  initialMask,
  onSave,
  onCancel,
  open = true,
}) => {
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState([15]);
  const [maxBrushSize, setMaxBrushSize] = useState(50);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cursorPos, setCursorPos] = useState<{
    x: number;
    y: number;
    scale?: number;
  } | null>(null);
  const [cropToMask, setCropToMask] = useState(true);
  const [removalTolerance, setRemovalTolerance] = useState([10]);
  const [isProcessing, setIsProcessing] = useState(false);

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskDataRef = useRef<ImageData | null>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const imageDimensionsRef = useRef<{ width: number; height: number }>({
    width: 27,
    height: 27,
  });

  const CANVAS_SIZE = 27;

  // Initialize canvases when image loads
  useEffect(() => {
    if (!open || !imageUrl) return;

    const img = new Image();
    // Only set crossOrigin for external URLs, not for data URLs
    if (!imageUrl.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      imageRef.current = img;
      initializeCanvases(img);
    };
    img.onerror = (error) => {
      console.error("Failed to load image:", error, "URL:", imageUrl);
      toast.error("Failed to load image", {
        description: "The image could not be loaded. Please try again.",
      });
    };
    img.src = imageUrl;
  }, [open, imageUrl]);

  const initializeCanvases = (img: HTMLImageElement) => {
    const originalCanvas = originalCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const resultCanvas = resultCanvasRef.current;

    if (!originalCanvas || !maskCanvas || !resultCanvas) return;

    // Store actual image dimensions
    imageDimensionsRef.current = { width: img.width, height: img.height };

    // Set canvas dimensions to actual image size
    const canvasWidth = img.width;
    const canvasHeight = img.height;
    [originalCanvas, maskCanvas, resultCanvas].forEach((canvas) => {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    });

    // Calculate and set max brush size (half of the larger dimension)
    const maxDimension = Math.max(canvasWidth, canvasHeight);
    const calculatedMaxBrushSize = Math.floor(maxDimension / 2);
    setMaxBrushSize(calculatedMaxBrushSize);

    // Reset brush size if it exceeds the new max
    const currentBrushSize = brushSize[0];
    if (currentBrushSize !== undefined && currentBrushSize > calculatedMaxBrushSize) {
      setBrushSize([Math.min(15, calculatedMaxBrushSize)]);
    }

    // Draw original image on all canvases
    const originalCtx = originalCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    const resultCtx = resultCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!originalCtx || !maskCtx || !resultCtx) return;

    // Draw scaled image on original canvas
    originalCtx.imageSmoothingEnabled = false;
    originalCtx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

    // Initialize mask data
    if (initialMask) {
      // Load existing mask from initialMask prop
      const maskImg = new Image();
      // Only set crossOrigin for external URLs, not for data URLs
      if (!initialMask.startsWith("data:")) {
        maskImg.crossOrigin = "anonymous";
      }
      maskImg.onload = () => {
        // Draw the mask image to get its pixel data
        maskCtx.drawImage(maskImg, 0, 0, canvasWidth, canvasHeight);
        const loadedMaskData = maskCtx.getImageData(
          0,
          0,
          canvasWidth,
          canvasHeight
        );

        // Use standard mask format: white (255) = visible, black (0) = masked
        // Store in RGB channels (alpha will be set to 255 for all pixels)
        maskDataRef.current = loadedMaskData;

        // Save initial state to history
        saveToHistory();

        // Update canvases
        updateMaskCanvas();
        updateResultCanvas();
      };
      maskImg.onerror = (error) => {
        console.error("Failed to load mask:", error, "Mask URL:", initialMask);
        toast.error("Failed to load mask", {
          description:
            "The mask could not be loaded. Starting with blank mask.",
        });
        // Fall back to blank mask
        maskDataRef.current = maskCtx.createImageData(
          canvasWidth,
          canvasHeight
        );
        saveToHistory();
        updateMaskCanvas();
        updateResultCanvas();
      };
      maskImg.src = initialMask;
    } else {
      // Initialize mask data (all visible initially - white = visible)
      maskDataRef.current = maskCtx.createImageData(canvasWidth, canvasHeight);
      // Set all pixels to white (255) = visible by default
      for (let i = 0; i < maskDataRef.current.data.length; i += 4) {
        maskDataRef.current.data[i] = 255; // R
        maskDataRef.current.data[i + 1] = 255; // G
        maskDataRef.current.data[i + 2] = 255; // B
        maskDataRef.current.data[i + 3] = 255; // A
      }

      // Save initial state to history
      saveToHistory();

      // Update canvases
      updateMaskCanvas();
      updateResultCanvas();
    }
  };

  const saveToHistory = () => {
    if (!maskDataRef.current) return;

    const newHistory = history.slice(0, historyIndex + 1);
    const maskCopy = new ImageData(
      new Uint8ClampedArray(maskDataRef.current.data),
      maskDataRef.current.width,
      maskDataRef.current.height
    );

    newHistory.push({ maskData: maskCopy });

    // Keep only last 10 states
    if (newHistory.length > 10) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }

    setHistory(newHistory);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const historyItem = history[newIndex];
      if (historyItem) {
        maskDataRef.current = new ImageData(
          new Uint8ClampedArray(historyItem.maskData.data),
          historyItem.maskData.width,
          historyItem.maskData.height
        );
      }
      updateMaskCanvas();
      updateResultCanvas();
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const historyItem = history[newIndex];
      if (historyItem) {
        maskDataRef.current = new ImageData(
          new Uint8ClampedArray(historyItem.maskData.data),
          historyItem.maskData.width,
          historyItem.maskData.height
        );
      }
      updateMaskCanvas();
      updateResultCanvas();
    }
  };

  const clearMask = () => {
    if (!maskDataRef.current) return;

    // Clear all mask data (set to black = fully masked)
    for (let i = 0; i < maskDataRef.current.data.length; i += 4) {
      maskDataRef.current.data[i] = 0; // R
      maskDataRef.current.data[i + 1] = 0; // G
      maskDataRef.current.data[i + 2] = 0; // B
      maskDataRef.current.data[i + 3] = 255; // A (fully opaque)
    }

    saveToHistory();
    updateMaskCanvas();
    updateResultCanvas();
  };

  const updateMaskCanvas = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !maskDataRef.current) return;

    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = imageDimensionsRef.current;

    // Draw mask visualization (white = visible, black = masked)
    // Standard format: use RGB brightness to determine visibility
    ctx.putImageData(maskDataRef.current, 0, 0);
  };

  const updateResultCanvas = () => {
    const resultCanvas = resultCanvasRef.current;
    if (!resultCanvas || !imageRef.current || !maskDataRef.current) return;

    const ctx = resultCanvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = imageDimensionsRef.current;

    // Draw checkerboard background
    ctx.clearRect(0, 0, width, height);
    const tileSize = 3;
    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        ctx.fillStyle =
          (x / tileSize + y / tileSize) % 2 === 0 ? "#666" : "#999";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }

    // Draw image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imageRef.current, 0, 0, width, height);

    // Apply mask (make masked areas transparent)
    // Standard format: black (RGB < 128) = masked, white (RGB >= 128) = visible
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const brightness = maskDataRef.current.data[i]; // Use red channel as brightness
      if (brightness !== undefined && brightness < 128) {
        imageData.data[i + 3] = 0; // Make transparent (black = masked)
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return null;

    const { width, height } = imageDimensionsRef.current;
    const rect = canvas.getBoundingClientRect();

    // Calculate the actual displayed size considering object-contain
    const containerAspect = rect.width / rect.height;
    const imageAspect = width / height;

    let displayWidth, displayHeight, offsetX, offsetY;

    if (imageAspect > containerAspect) {
      // Image is wider - fits to width
      displayWidth = rect.width;
      displayHeight = rect.width / imageAspect;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    } else {
      // Image is taller - fits to height
      displayWidth = rect.height * imageAspect;
      displayHeight = rect.height;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    }

    const scaleX = width / displayWidth;
    const scaleY = height / displayHeight;

    const x = Math.floor((e.clientX - rect.left - offsetX) * scaleX);
    const y = Math.floor((e.clientY - rect.top - offsetY) * scaleY);

    return { x, y };
  };

  const drawOnMask = (x: number, y: number) => {
    if (!maskDataRef.current) return;

    const { width, height } = imageDimensionsRef.current;
    const currentBrushSize = brushSize[0];
    if (currentBrushSize === undefined) return;
    const radius = Math.floor(currentBrushSize / 2);
    const isErasing = tool === "eraser";

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const px = x + dx;
          const py = y + dy;

          if (px >= 0 && px < width && py >= 0 && py < height) {
            const index = (py * width + px) * 4;
            // brush = black (0, transparent/masked), eraser = white (255, visible)
            const value = isErasing ? 255 : 0;
            maskDataRef.current.data[index] = value; // R
            maskDataRef.current.data[index + 1] = value; // G
            maskDataRef.current.data[index + 2] = value; // B
            maskDataRef.current.data[index + 3] = 255; // A (fully opaque)
          }
        }
      }
    }

    updateMaskCanvas();
    updateResultCanvas();
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    setIsDrawing(true);
    drawOnMask(coords.x, coords.y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (resultContainerRef.current && resultCanvasRef.current) {
      const containerRect = resultContainerRef.current.getBoundingClientRect();
      const canvasRect = resultCanvasRef.current.getBoundingClientRect();
      const { width, height } = imageDimensionsRef.current;

      // Calculate the actual displayed size considering object-contain
      const containerAspect = canvasRect.width / canvasRect.height;
      const imageAspect = width / height;

      let displayWidth, displayHeight;

      if (imageAspect > containerAspect) {
        // Image is wider - fits to width
        displayWidth = canvasRect.width;
        displayHeight = canvasRect.width / imageAspect;
      } else {
        // Image is taller - fits to height
        displayWidth = canvasRect.height * imageAspect;
        displayHeight = canvasRect.height;
      }

      // Calculate scale factor based on actual displayed size
      const scale = displayWidth / width;

      setCursorPos({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
        scale, // Store scale for brush indicator
      });
    }

    if (!isDrawing) return;

    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    drawOnMask(coords.x, coords.y);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (resultContainerRef.current && resultCanvasRef.current) {
      const containerRect = resultContainerRef.current.getBoundingClientRect();
      const canvasRect = resultCanvasRef.current.getBoundingClientRect();
      const { width, height } = imageDimensionsRef.current;

      // Calculate the actual displayed size considering object-contain
      const containerAspect = canvasRect.width / canvasRect.height;
      const imageAspect = width / height;

      let displayWidth, displayHeight;

      if (imageAspect > containerAspect) {
        // Image is wider - fits to width
        displayWidth = canvasRect.width;
        displayHeight = canvasRect.width / imageAspect;
      } else {
        // Image is taller - fits to height
        displayWidth = canvasRect.height * imageAspect;
        displayHeight = canvasRect.height;
      }

      const scale = displayWidth / width;

      setCursorPos({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
        scale,
      });
    }
  };

  const handleMouseLeave = () => {
    setCursorPos(null);
    if (isDrawing) {
      setIsDrawing(false);
      saveToHistory();
    }
  };

  const handleMouseUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      saveToHistory();
    }
  };

  const findMaskBounds = () => {
    if (!maskDataRef.current) return null;

    const { width, height } = imageDimensionsRef.current;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    let foundWhite = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const maskValue = maskDataRef.current.data[idx]; // R channel
        if (maskValue === undefined) continue;
        if (maskValue > 0) {
          // White pixel (visible)
          foundWhite = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!foundWhite) return null;

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  };

  const handleSave = () => {
    if (!originalCanvasRef.current || !maskDataRef.current) return;

    const { width, height } = imageDimensionsRef.current;

    // Find crop bounds if enabled
    const bounds = cropToMask ? findMaskBounds() : null;
    const cropX = bounds?.x ?? 0;
    const cropY = bounds?.y ?? 0;
    const cropWidth = bounds?.width ?? width;
    const cropHeight = bounds?.height ?? height;

    // Create canvas for the mask (black/white)
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = cropWidth;
    maskCanvas.height = cropHeight;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return;

    // Export the mask as black/white image (cropped if enabled)
    const fullMaskCanvas = document.createElement("canvas");
    fullMaskCanvas.width = width;
    fullMaskCanvas.height = height;
    const fullMaskCtx = fullMaskCanvas.getContext("2d");
    if (!fullMaskCtx) return;
    fullMaskCtx.putImageData(maskDataRef.current, 0, 0);

    maskCtx.drawImage(
      fullMaskCanvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );
    const maskImage = maskCanvas.toDataURL("image/png");

    // Create a new canvas for the final masked image
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = cropWidth;
    outputCanvas.height = cropHeight;
    const ctx = outputCanvas.getContext("2d");
    if (!ctx) return;

    // Draw original image (cropped if enabled)
    ctx.drawImage(
      originalCanvasRef.current,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    // Apply mask as alpha channel
    const imageData = ctx.getImageData(0, 0, cropWidth, cropHeight);
    const maskData = maskCtx.getImageData(0, 0, cropWidth, cropHeight);

    for (let i = 0; i < imageData.data.length; i += 4) {
      // maskData stores: black (RGB = 0) = transparent, white (RGB = 255) = visible
      const maskValue = maskData.data[i]; // R channel (0 = black, 255 = white)
      if (maskValue === 0) {
        imageData.data[i + 3] = 0; // Make transparent
      } else {
        // Keep original pixel data but ensure it's fully opaque
        imageData.data[i + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Export as base64 PNG
    const maskedImage = outputCanvas.toDataURL("image/png");
    onSave(maskedImage, maskImage);
    toast.success(
      cropToMask && bounds
        ? `Mask saved (cropped to ${cropWidth}x${cropHeight})`
        : "Mask saved"
    );
  };

  const handleReset = () => {
    clearMask();
  };

  const getCurrentMaskedImage = (): string | null => {
    if (!originalCanvasRef.current || !maskDataRef.current || !imageRef.current)
      return null;

    const { width, height } = imageDimensionsRef.current;

    // Create a temporary canvas to generate the current masked image
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return null;

    // Draw the original image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imageRef.current, 0, 0, width, height);

    // Apply the current mask to make masked areas transparent
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const brightness = maskDataRef.current.data[i]; // Use red channel as brightness
      if (brightness === undefined) continue;
      if (brightness < 128) {
        // Masked area (black in mask) - make transparent
        imageData.data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    return tempCanvas.toDataURL("image/png");
  };

  const handleRemoveBackground = async () => {
    if (
      !imageUrl ||
      !maskDataRef.current ||
      !originalCanvasRef.current ||
      isProcessing
    )
      return;

    setIsProcessing(true);
    try {
      // Get the current edited image (original image with current mask applied)
      const currentEditedImage = getCurrentMaskedImage();
      if (!currentEditedImage) {
        toast.error("Failed to get current image state");
        setIsProcessing(false);
        return;
      }

      const result = await applyBackgroundRemoval(
        currentEditedImage,
        maskDataRef.current,
        removalTolerance[0]
      );

      if (result.success && result.maskData) {
        maskDataRef.current = result.maskData;
        saveToHistory();
        updateMaskCanvas();
        updateResultCanvas();
        toast.success(result.message || "Background removed successfully");
      } else {
        toast.error(result.message || "Failed to remove background");
      }
    } catch (error) {
      console.error("Background removal error:", error);
      toast.error("Failed to remove background");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveBorder = async () => {
    if (
      !imageUrl ||
      !maskDataRef.current ||
      !originalCanvasRef.current ||
      isProcessing
    )
      return;

    setIsProcessing(true);
    try {
      // Get the current edited image (original image with current mask applied)
      const currentEditedImage = getCurrentMaskedImage();
      if (!currentEditedImage) {
        toast.error("Failed to get current image state");
        setIsProcessing(false);
        return;
      }

      const result = await applyBorderRemoval(
        currentEditedImage,
        maskDataRef.current,
        removalTolerance[0]
      );

      if (result.success && result.maskData) {
        maskDataRef.current = result.maskData;
        saveToHistory();
        updateMaskCanvas();
        updateResultCanvas();
        toast.success(result.message || "Border removed successfully");
      } else {
        toast.error(result.message || "Failed to remove border");
      }
    } catch (error) {
      console.error("Border removal error:", error);
      toast.error("Failed to remove border");
    } finally {
      setIsProcessing(false);
    }
  };

  const onClose = () => {
    onCancel();
  };

  const imageName =
    imageNameProp || imageUrl.split("/").pop()?.split("?")[0] || "Image";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent
        className="!top-[5vh] !translate-y-0 bg-[#0A0A0B] border-gray-800 !max-w-[68vw] p-0 gap-0 flex flex-col"
        style={{ height: "90vh", maxHeight: "90vh" }}
        showCloseButton={false}
      >
        {/* Custom Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0">
          <DialogTitle className="text-lg font-semibold">
            Mask Editor - {imageName}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Edit mask by painting transparent areas with brush and revealing
            areas with eraser
          </DialogDescription>
          <div className="flex items-center gap-3 mr-8">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={cropToMask}
                onChange={(e) => setCropToMask(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-[#BD00FF] focus:ring-[#BD00FF] focus:ring-offset-0"
              />
              <span>Crop to mask</span>
            </label>
            <Button
              onClick={handleSave}
              size="sm"
              className="bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
            >
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
            <Button
              onClick={onClose}
              size="sm"
              variant="outline"
              className="border-gray-700 hover:border-gray-600"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left Toolbar */}
          <div className="w-12 bg-gray-800 flex flex-col items-center py-4 gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "w-9 h-9",
                tool === "brush" &&
                  "bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
              )}
              onClick={() => setTool("brush")}
              title="Brush - Add to mask"
            >
              <Paintbrush className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "w-9 h-9",
                tool === "eraser" &&
                  "bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
              )}
              onClick={() => setTool("eraser")}
              title="Eraser - Remove from mask"
            >
              <Eraser className="w-4 h-4" />
            </Button>

            <Separator className="w-6 my-1" />

            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={undo}
              disabled={historyIndex <= 0}
              title="Undo"
            >
              <Undo className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              title="Redo"
            >
              <Redo className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={clearMask}
              title="Clear all masks"
            >
              <Trash2 className="w-4 h-4" />
            </Button>

            <Separator className="w-6 my-1" />

            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={handleRemoveBackground}
              disabled={isProcessing}
              title="Remove Background"
            >
              <Sparkles className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={handleRemoveBorder}
              disabled={isProcessing}
              title="Remove Border"
            >
              <Box className="w-4 h-4" />
            </Button>
          </div>

          {/* Center Canvas Area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top Controls */}
            <div className="bg-gray-800 p-2 flex items-center gap-4 shrink-0">
              <span className="text-sm text-gray-400 whitespace-nowrap">
                Brush Size:
              </span>
              <Slider
                value={brushSize}
                onValueChange={setBrushSize}
                min={1}
                max={maxBrushSize}
                step={1}
                className="w-48"
              />
              <span className="text-sm text-gray-300 w-8">{brushSize[0]}</span>

              <Separator orientation="vertical" className="h-6 mx-2" />

              <span className="text-sm text-gray-400 whitespace-nowrap">
                Removal Tolerance:
              </span>
              <Slider
                value={removalTolerance}
                onValueChange={setRemovalTolerance}
                min={0}
                max={50}
                step={1}
                className="w-48"
              />
              <span className="text-sm text-gray-300 w-8">
                {removalTolerance[0]}
              </span>
            </div>

            <div className="flex-1 flex gap-4 p-4 bg-[#0A0A0B] min-h-0">
              {/* Left Side - Result Canvas (Editable) */}
              <div className="flex-1 flex flex-col gap-2 min-w-0">
                <h3 className="text-sm font-medium text-[#00D9FF] text-center shrink-0">
                  Result (with Transparency) - Draw Here
                </h3>
                <div
                  ref={resultContainerRef}
                  className="flex-1 bg-gray-800 rounded overflow-hidden relative min-h-0"
                >
                  <canvas
                    ref={resultCanvasRef}
                    className="w-full h-full object-contain cursor-none"
                    style={{ imageRendering: "pixelated" }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  />
                  {cursorPos && (
                    <div
                      className="absolute pointer-events-none border-2 border-white rounded-full"
                      style={{
                        left: cursorPos.x,
                        top: cursorPos.y,
                        width: (brushSize[0] ?? 15) * (cursorPos.scale || 1),
                        height: (brushSize[0] ?? 15) * (cursorPos.scale || 1),
                        transform: "translate(-50%, -50%)",
                        opacity: 0.5,
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Right Side - Reference Canvases (Display Only) */}
              <div className="w-64 flex flex-col gap-4 shrink-0">
                {/* Original Image */}
                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <h3 className="text-sm font-medium text-gray-400 text-center shrink-0">
                    Original Image
                  </h3>
                  <div className="flex-1 bg-gray-800 rounded overflow-hidden min-h-0">
                    <canvas
                      ref={originalCanvasRef}
                      className="w-full h-full object-contain"
                      style={{ imageRendering: "pixelated" }}
                    />
                  </div>
                </div>

                {/* Mask Visualization */}
                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <h3 className="text-sm font-medium text-gray-400 text-center shrink-0">
                    Mask
                  </h3>
                  <div className="flex-1 bg-gray-800 rounded overflow-hidden min-h-0">
                    <canvas
                      ref={maskCanvasRef}
                      className="w-full h-full object-contain"
                      style={{ imageRendering: "pixelated" }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 p-2 text-xs text-gray-400 shrink-0">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  <strong className="text-gray-300">Result:</strong> Draw on
                  this canvas to edit the mask (shows final image with
                  transparency)
                </li>
                <li>
                  <strong className="text-gray-300">Original:</strong>{" "}
                  Unmodified source image
                </li>
                <li>
                  <strong className="text-gray-300">Mask:</strong> Visual
                  representation of the mask (white = visible, black =
                  transparent)
                </li>
                <li>
                  <strong className="text-gray-300">Brush:</strong> Add pixels
                  to mask (make areas visible)
                </li>
                <li>
                  <strong className="text-gray-300">Eraser:</strong> Remove
                  pixels from mask (make areas transparent)
                </li>
                <li>
                  <strong className="text-gray-300">Undo/Redo:</strong> Navigate
                  through last 10 changes
                </li>
                <li>
                  <strong className="text-gray-300">Remove Background:</strong>{" "}
                  Automatically detect and remove background (samples edge
                  colors)
                </li>
                <li>
                  <strong className="text-gray-300">Remove Border:</strong>{" "}
                  Automatically detect and remove border pixels
                </li>
                <li>
                  <strong className="text-gray-300">Removal Tolerance:</strong>{" "}
                  Adjust color matching sensitivity (0-50, default: 10)
                </li>
              </ul>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
