import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  applyBackgroundRemoval,
  applyBorderRemoval,
} from "@/lib/mask-processing";
import type {
  CursorPosition,
  HistoryState,
  ImageDimensions,
  Tool,
} from "../mask-editor-types";
import {
  createMaskedImage,
  drawCheckerboard,
  drawOnMask as drawOnMaskUtil,
  findMaskBounds,
  getCanvasCoordinates,
  getDisplayScale,
} from "../mask-editor-utils";

interface UseMaskEditorStateOptions {
  imageUrl: string;
  initialMask?: string;
  open: boolean;
  onSave: (maskedImage: string, mask: string) => void;
}

export function useMaskEditorState({
  imageUrl,
  initialMask,
  open,
  onSave,
}: UseMaskEditorStateOptions) {
  // --- State ---
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState([15]);
  const [maxBrushSize, setMaxBrushSize] = useState(50);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cursorPos, setCursorPos] = useState<CursorPosition | null>(null);
  const [cropToMask, setCropToMask] = useState(true);
  const [removalTolerance, setRemovalTolerance] = useState([10]);
  const [isProcessing, setIsProcessing] = useState(false);

  // --- Refs ---
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskDataRef = useRef<ImageData | null>(null);
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const imageDimensionsRef = useRef<ImageDimensions>({
    width: 27,
    height: 27,
  });

  // --- Canvas update helpers (use refs, no deps) ---

  const updateMaskCanvas = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !maskDataRef.current) return;

    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return;

    ctx.putImageData(maskDataRef.current, 0, 0);
  };

  const updateResultCanvas = () => {
    const resultCanvas = resultCanvasRef.current;
    if (!resultCanvas || !imageRef.current || !maskDataRef.current) return;

    const ctx = resultCanvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = imageDimensionsRef.current;

    // Draw checkerboard background
    drawCheckerboard(ctx, width, height);

    // Draw image
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imageRef.current, 0, 0, width, height);

    // Apply mask (make masked areas transparent)
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const brightness = maskDataRef.current.data[i]; // Use red channel as brightness
      if (brightness !== undefined && brightness < 128) {
        imageData.data[i + 3] = 0; // Make transparent (black = masked)
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  // --- History ---

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
      setHistoryIndex((prev) => prev + 1);
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

  // --- Canvas initialization ---

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
    if (
      currentBrushSize !== undefined &&
      currentBrushSize > calculatedMaxBrushSize
    ) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageUrl]);

  // --- Drawing handlers ---

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const coords = getCanvasCoordinates(e, canvas, imageDimensionsRef.current);
    if (!coords) return;

    setIsDrawing(true);
    if (maskDataRef.current) {
      const currentBrushSize = brushSize[0];
      if (currentBrushSize !== undefined) {
        drawOnMaskUtil(
          maskDataRef.current,
          coords.x,
          coords.y,
          currentBrushSize,
          tool,
          imageDimensionsRef.current
        );
        updateMaskCanvas();
        updateResultCanvas();
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (resultContainerRef.current && resultCanvasRef.current) {
      const containerRect = resultContainerRef.current.getBoundingClientRect();
      const canvasRect = resultCanvasRef.current.getBoundingClientRect();
      const scale = getDisplayScale(canvasRect, imageDimensionsRef.current);

      setCursorPos({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
        scale,
      });
    }

    if (!isDrawing) return;

    const canvas = resultCanvasRef.current;
    if (!canvas) return;
    const coords = getCanvasCoordinates(e, canvas, imageDimensionsRef.current);
    if (!coords) return;

    if (maskDataRef.current) {
      const currentBrushSize = brushSize[0];
      if (currentBrushSize !== undefined) {
        drawOnMaskUtil(
          maskDataRef.current,
          coords.x,
          coords.y,
          currentBrushSize,
          tool,
          imageDimensionsRef.current
        );
        updateMaskCanvas();
        updateResultCanvas();
      }
    }
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (resultContainerRef.current && resultCanvasRef.current) {
      const containerRect = resultContainerRef.current.getBoundingClientRect();
      const canvasRect = resultCanvasRef.current.getBoundingClientRect();
      const scale = getDisplayScale(canvasRect, imageDimensionsRef.current);

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

  // --- Save ---

  const handleSave = () => {
    if (!originalCanvasRef.current || !maskDataRef.current) return;

    const { width, height } = imageDimensionsRef.current;

    // Find crop bounds if enabled
    const bounds = cropToMask
      ? findMaskBounds(maskDataRef.current, imageDimensionsRef.current)
      : null;
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
      const maskValue = maskData.data[i]; // R channel (0 = black, 255 = white)
      if (maskValue === 0) {
        imageData.data[i + 3] = 0; // Make transparent
      } else {
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

  // --- Background / Border removal ---

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
      const currentEditedImage = imageRef.current
        ? createMaskedImage(
            imageRef.current,
            maskDataRef.current,
            imageDimensionsRef.current
          )
        : null;
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
      const currentEditedImage = imageRef.current
        ? createMaskedImage(
            imageRef.current,
            maskDataRef.current,
            imageDimensionsRef.current
          )
        : null;
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

  return {
    // State
    tool,
    setTool,
    brushSize,
    setBrushSize,
    maxBrushSize,
    isDrawing,
    history,
    historyIndex,
    cursorPos,
    cropToMask,
    setCropToMask,
    removalTolerance,
    setRemovalTolerance,
    isProcessing,

    // Refs
    originalCanvasRef,
    maskCanvasRef,
    resultCanvasRef,
    resultContainerRef,

    // Actions
    undo,
    redo,
    clearMask,
    handleSave,
    handleMouseDown,
    handleMouseMove,
    handleMouseEnter,
    handleMouseLeave,
    handleMouseUp,
    handleRemoveBackground,
    handleRemoveBorder,
  };
}
