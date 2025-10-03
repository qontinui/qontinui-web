import React, { useState, useRef, useEffect } from 'react';
import { Region } from '@/types/pattern-optimization';
import { patternOptimizationStorage } from '@/lib/pattern-optimization-storage';

interface RegionSelectorProps {
  screenshotId: string;
  screenshotUrl: string; // ID reference to IndexedDB
  initialRegion?: Region;
  onRegionChange: (region: Region) => void;
}

/**
 * Region Selector Component
 * Single Responsibility: Handle region selection on screenshots
 */
export const RegionSelector: React.FC<RegionSelectorProps> = ({
  screenshotId,
  screenshotUrl,
  initialRegion,
  onRegionChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Region | null>(initialRegion || null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  // Load image from IndexedDB
  useEffect(() => {
    const loadImage = async () => {
      try {
        const data = await patternOptimizationStorage.getImage(screenshotUrl);
        if (data) {
          setImageData(data);

          // Get image dimensions
          const img = new Image();
          img.onload = () => {
            setImageDimensions({ width: img.width, height: img.height });
          };
          img.src = data;
        }
      } catch (error) {
        console.error('Failed to load image:', error);
        // Fallback: treat URL as data URL
        setImageData(screenshotUrl);
      }
    };

    loadImage();
  }, [screenshotUrl]);

  // Draw image and region on canvas
  useEffect(() => {
    if (!canvasRef.current || !imageData || !imageDimensions) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Set canvas size to match container
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // Calculate scale to fit image in container
      const scaleX = containerWidth / img.width;
      const scaleY = containerHeight / img.height;
      const scale = Math.min(scaleX, scaleY, 1); // Don't upscale

      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      // Draw image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Draw region if exists
      if (currentRegion) {
        const scaledRegion = {
          x: currentRegion.x * scale,
          y: currentRegion.y * scale,
          width: currentRegion.width * scale,
          height: currentRegion.height * scale,
        };

        // Draw semi-transparent overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Clear the selected region (make it visible)
        ctx.clearRect(scaledRegion.x, scaledRegion.y, scaledRegion.width, scaledRegion.height);

        // Draw selection border
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2;
        ctx.strokeRect(scaledRegion.x, scaledRegion.y, scaledRegion.width, scaledRegion.height);

        // Draw corner handles
        const handleSize = 8;
        ctx.fillStyle = '#3B82F6';

        // Top-left
        ctx.fillRect(scaledRegion.x - handleSize/2, scaledRegion.y - handleSize/2, handleSize, handleSize);
        // Top-right
        ctx.fillRect(scaledRegion.x + scaledRegion.width - handleSize/2, scaledRegion.y - handleSize/2, handleSize, handleSize);
        // Bottom-left
        ctx.fillRect(scaledRegion.x - handleSize/2, scaledRegion.y + scaledRegion.height - handleSize/2, handleSize, handleSize);
        // Bottom-right
        ctx.fillRect(scaledRegion.x + scaledRegion.width - handleSize/2, scaledRegion.y + scaledRegion.height - handleSize/2, handleSize, handleSize);

        // Draw dimensions
        ctx.fillStyle = '#3B82F6';
        ctx.font = '12px monospace';
        ctx.fillText(
          `${Math.round(currentRegion.width)} × ${Math.round(currentRegion.height)}`,
          scaledRegion.x + scaledRegion.width / 2 - 30,
          scaledRegion.y - 5
        );
      }
    };

    img.src = imageData;
  }, [imageData, imageDimensions, currentRegion]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !imageDimensions) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / imageDimensions.width;

    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    setStartPoint({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !canvasRef.current || !imageDimensions) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / imageDimensions.width;

    const currentX = (e.clientX - rect.left) / scale;
    const currentY = (e.clientY - rect.top) / scale;

    const region: Region = {
      x: Math.min(startPoint.x, currentX),
      y: Math.min(startPoint.y, currentY),
      width: Math.abs(currentX - startPoint.x),
      height: Math.abs(currentY - startPoint.y),
    };

    setCurrentRegion(region);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentRegion) return;

    setIsDrawing(false);
    setStartPoint(null);

    // Only save region if it's not too small
    if (currentRegion.width > 10 && currentRegion.height > 10) {
      onRegionChange(currentRegion);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="p-2 bg-gray-100 border-b text-sm text-gray-700">
        <p className="font-medium">Draw a rectangle around the UI element</p>
        <p className="text-xs text-gray-600 mt-1">Click and drag to select the region</p>
      </div>

      <div ref={containerRef} className="flex-1 bg-gray-50 p-4 overflow-hidden">
        {imageData ? (
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="cursor-crosshair mx-auto shadow-lg"
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Loading image...
          </div>
        )}
      </div>

      {currentRegion && (
        <div className="p-2 bg-gray-100 border-t text-xs text-gray-700">
          <div className="flex justify-between">
            <span>Position: ({Math.round(currentRegion.x)}, {Math.round(currentRegion.y)})</span>
            <span>Size: {Math.round(currentRegion.width)} × {Math.round(currentRegion.height)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
