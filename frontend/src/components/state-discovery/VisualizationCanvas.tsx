/**
 * Visualization Canvas Component
 * Displays screenshots with StateImage overlays
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { StateImage } from "@/types/stateDiscovery";
import { cn } from "@/lib/utils";

interface VisualizationCanvasProps {
  screenshot: File;
  stateImages: StateImage[];
  selectedStateImage: StateImage | null;
  selectedStateImages: Set<string>;
  highlightedStateImages?: string[];
  viewMode: "all" | "selected" | "state";
  onSelectStateImage: (stateImage: StateImage) => void;
  onMultiSelectStateImage: (stateImageId: string, ctrlKey: boolean) => void;
  screenshotIndex?: number;
  maxDarkPixelPercentage?: number;
  maxLightPixelPercentage?: number;
  scale?: number;
  onScaleChange?: (scale: number) => void;
  onImageSizeChange?: (size: { width: number; height: number }) => void;
  showMasks?: boolean;
  maskOpacity?: number;
}

const VisualizationCanvas: React.FC<VisualizationCanvasProps> = ({
  screenshot,
  stateImages,
  selectedStateImage,
  selectedStateImages,
  highlightedStateImages = [],
  viewMode,
  onSelectStateImage,
  onMultiSelectStateImage,
  screenshotIndex,
  maxDarkPixelPercentage = 100,
  maxLightPixelPercentage = 100,
  scale: propScale = 1,
  onScaleChange,
  onImageSizeChange,
  showMasks = false,
  maskOpacity = 0.3,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const scale = propScale;
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [hoveredStateImage, setHoveredStateImage] = useState<string | null>(
    null
  );
  const [imageData, setImageData] = useState<ImageData | null>(null);

  // Load screenshot
  useEffect(() => {
    if (screenshot) {
      const url = URL.createObjectURL(screenshot);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [screenshot]);

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !imageUrl) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas size
      canvas.width = img.width;
      canvas.height = img.height;
      const newSize = { width: img.width, height: img.height };
      setImageSize(newSize);
      onImageSizeChange?.(newSize);

      // Calculate scale to fit container
      if (containerRef.current && onScaleChange) {
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        const scaleX = containerWidth / img.width;
        const scaleY = containerHeight / img.height;
        onScaleChange(Math.min(scaleX, scaleY, 1));
      }

      // Draw image
      ctx.drawImage(img, 0, 0);

      // Store image data for pixel analysis
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setImageData(imgData);

      // Draw StateImages
      drawStateImages(ctx);
    };
    img.src = imageUrl;
  }, [
    imageUrl,
    stateImages,
    selectedStateImage,
    selectedStateImages,
    highlightedStateImages,
    viewMode,
    hoveredStateImage,
    screenshotIndex,
    maxDarkPixelPercentage,
    maxLightPixelPercentage,
  ]);

  // Calculate dark and light pixel percentages for a region
  const calculatePixelPercentages = (
    stateImage: StateImage
  ): { darkPercentage: number; lightPercentage: number } => {
    if (!imageData) return { darkPercentage: 0, lightPercentage: 0 };

    const { x, y, x2, y2 } = stateImage;
    const width = x2 - x;
    const height = y2 - y;

    let darkPixels = 0;
    let lightPixels = 0;
    let totalPixels = 0;

    // Define thresholds for dark and light pixels
    const darkThreshold = 60; // Pixels with brightness < 60 are considered dark
    const lightThreshold = 200; // Pixels with brightness > 200 are considered light

    for (let py = y; py < y2 && py < imageData.height; py++) {
      for (let px = x; px < x2 && px < imageData.width; px++) {
        const index = (py * imageData.width + px) * 4;
        const r = imageData.data[index] ?? 0;
        const g = imageData.data[index + 1] ?? 0;
        const b = imageData.data[index + 2] ?? 0;

        // Calculate brightness (simple average)
        const brightness = (r + g + b) / 3;

        if (brightness < darkThreshold) {
          darkPixels++;
        } else if (brightness > lightThreshold) {
          lightPixels++;
        }
        totalPixels++;
      }
    }

    const darkPercentage =
      totalPixels > 0 ? (darkPixels / totalPixels) * 100 : 0;
    const lightPercentage =
      totalPixels > 0 ? (lightPixels / totalPixels) * 100 : 0;

    return { darkPercentage, lightPercentage };
  };

  // Draw StateImage overlays
  const drawStateImages = (ctx: CanvasRenderingContext2D) => {
    // First filter by screenshot - only show state images that appear in this screenshot
    let visibleStateImages = stateImages;

    // Get the screenshot ID based on the index or filename
    // The screenshot filename is the original file name, but we need to match with the screenshot IDs
    // stored in the stateImage.screenshots array
    if (screenshotIndex !== undefined) {
      // Generate the screenshot ID that matches what's stored in stateImage.screenshots
      const screenshotId = `screenshot_${screenshotIndex.toString().padStart(3, "0")}`;
      // Filter based on screenshot ID

      // Filter to only state images that appear in this screenshot
      visibleStateImages = stateImages.filter((si) => {
        const appearsInScreenshot = si.screenshots?.includes(screenshotId);
        // Check if state image appears in this screenshot
        return appearsInScreenshot;
      });

      // Filtering complete
    }

    // Then apply view mode filters
    if (viewMode === "selected" && selectedStateImages.size > 0) {
      visibleStateImages = visibleStateImages.filter((si) =>
        selectedStateImages.has(si.id)
      );
    } else if (viewMode === "state" && selectedStateImage) {
      // Show only StateImages from the same state
      // This would require state membership info
      visibleStateImages = [selectedStateImage];
    }

    // Apply pixel percentage filters
    if (maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) {
      visibleStateImages = visibleStateImages.filter((stateImage) => {
        // Use backend data if available
        if (
          stateImage.darkPixelPercentage !== undefined &&
          stateImage.lightPixelPercentage !== undefined
        ) {
          const passedDarkFilter =
            stateImage.darkPixelPercentage <= maxDarkPixelPercentage;
          const passedLightFilter =
            stateImage.lightPixelPercentage <= maxLightPixelPercentage;

          if (!passedDarkFilter || !passedLightFilter) {
            // Filtered out due to pixel thresholds
          }

          return passedDarkFilter && passedLightFilter;
        }

        // Fall back to client-side calculation if backend data not available
        if (imageData) {
          const { darkPercentage, lightPercentage } =
            calculatePixelPercentages(stateImage);

          // Filter out images that exceed the thresholds
          const passedDarkFilter = darkPercentage <= maxDarkPixelPercentage;
          const passedLightFilter = lightPercentage <= maxLightPixelPercentage;

          if (!passedDarkFilter || !passedLightFilter) {
            // Filtered out due to pixel thresholds
          }

          return passedDarkFilter && passedLightFilter;
        }

        return true;
      });

      // Pixel filtering complete
    }

    // Draw each StateImage
    visibleStateImages.forEach((stateImage) => {
      const isSelected = selectedStateImage?.id === stateImage.id;
      const isInSelection = selectedStateImages.has(stateImage.id);
      const isHighlighted = highlightedStateImages.includes(stateImage.id);
      const isHovered = hoveredStateImage === stateImage.id;

      // Set styles based on state
      if (isSelected) {
        ctx.strokeStyle = "#3B82F6"; // Blue
        ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
        ctx.lineWidth = 3;
      } else if (isHighlighted) {
        ctx.strokeStyle = "#F59E0B"; // Amber/Orange for highlighted
        ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
        ctx.lineWidth = 3;
      } else if (isInSelection) {
        ctx.strokeStyle = "#10B981"; // Green
        ctx.fillStyle = "rgba(16, 185, 129, 0.2)";
        ctx.lineWidth = 2;
      } else if (isHovered) {
        ctx.strokeStyle = "#00FF00";
        ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = "#00FF00";
        ctx.fillStyle = "rgba(0, 255, 0, 0.1)";
        ctx.lineWidth = 1;
      }

      // Draw rectangle or mask
      const width = stateImage.x2 - stateImage.x;
      const height = stateImage.y2 - stateImage.y;

      // If masks are enabled and StateImage has a mask, show mask density visualization
      if (
        showMasks &&
        stateImage.hasMask &&
        stateImage.maskDensity !== undefined
      ) {
        // Draw mask visualization
        // For now, we'll visualize the mask density as a filled area within the rectangle
        const maskWidth = width * (stateImage.maskDensity || 1.0);
        const maskHeight = height * (stateImage.maskDensity || 1.0);
        const maskX = stateImage.x + (width - maskWidth) / 2;
        const maskY = stateImage.y + (height - maskHeight) / 2;

        // Draw the full rectangle outline
        ctx.strokeRect(stateImage.x, stateImage.y, width, height);

        // Draw mask area with different opacity
        ctx.save();
        ctx.globalAlpha = maskOpacity;

        // Use a different color for mask
        if (isSelected) {
          ctx.fillStyle = "rgba(59, 130, 246, 0.5)"; // Blue
        } else if (isHighlighted) {
          ctx.fillStyle = "rgba(245, 158, 11, 0.5)"; // Amber
        } else if (isInSelection) {
          ctx.fillStyle = "rgba(16, 185, 129, 0.5)"; // Green
        } else {
          ctx.fillStyle = "rgba(147, 51, 234, 0.5)"; // Purple for mask
        }

        ctx.fillRect(maskX, maskY, maskWidth, maskHeight);
        ctx.restore();

        // Draw mask density indicator
        if (isSelected || isHovered) {
          ctx.save();
          ctx.font = "10px sans-serif";
          ctx.fillStyle = "#9333EA"; // Purple
          ctx.fillText(
            `${Math.round((stateImage.maskDensity || 1.0) * 100)}%`,
            stateImage.x2 - 30,
            stateImage.y2 - 5
          );
          ctx.restore();
        }
      } else {
        // Normal rectangle drawing
        ctx.fillRect(stateImage.x, stateImage.y, width, height);
        ctx.strokeRect(stateImage.x, stateImage.y, width, height);
      }

      // Draw label
      if (isSelected || isHovered) {
        ctx.font = "12px sans-serif";
        ctx.fillStyle = isSelected ? "#3B82F6" : "#00FF00";
        ctx.fillText(
          stateImage.name || `SI_${stateImage.id.substring(0, 6)}`,
          stateImage.x,
          stateImage.y - 5
        );
      }
    });
  };

  // Handle click
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      // Find clicked StateImage
      const clicked = stateImages.find(
        (si) => x >= si.x && x <= si.x2 && y >= si.y && y <= si.y2
      );

      if (clicked) {
        if (e.ctrlKey || e.metaKey) {
          onMultiSelectStateImage(clicked.id, true);
        } else {
          onSelectStateImage(clicked);
        }
      }
    },
    [stateImages, scale, onSelectStateImage, onMultiSelectStateImage]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      // Find hovered StateImage
      const hovered = stateImages.find(
        (si) => x >= si.x && x <= si.x2 && y >= si.y && y <= si.y2
      );

      setHoveredStateImage(hovered?.id || null);

      // Set cursor
      canvasRef.current.style.cursor = hovered ? "pointer" : "default";
    },
    [stateImages, scale]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center bg-checker-pattern"
    >
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{
          width: imageSize.width * scale,
          height: imageSize.height * scale,
        }}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredStateImage(null)}
      />
    </div>
  );
};

export default VisualizationCanvas;
