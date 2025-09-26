import React, { useRef, useState, useEffect } from 'react';
import { Screenshot, ScreenshotRegion, ScreenshotLocation, SelectionMode } from '../../types/Screenshot';
import { generateId } from '../../lib/utils';

interface ScreenshotCanvasProps {
  screenshot: Screenshot;
  selectionMode: SelectionMode;
  onRegionCreate: (region: ScreenshotRegion) => void;
  onLocationCreate: (location: ScreenshotLocation) => void;
  onRegionSelect: (region: ScreenshotRegion | null) => void;
  onLocationSelect: (location: ScreenshotLocation | null) => void;
}

const ScreenshotCanvas: React.FC<ScreenshotCanvasProps> = ({
  screenshot,
  selectionMode,
  onRegionCreate,
  onLocationCreate,
  onRegionSelect,
  onLocationSelect
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<DOMRect | null>(null);
  const [scale, setScale] = useState(1);
  const [hoveredRegion, setHoveredRegion] = useState<ScreenshotRegion | null>(null);
  const [hoveredLocation, setHoveredLocation] = useState<ScreenshotLocation | null>(null);

  useEffect(() => {
    drawCanvas();
  }, [screenshot, scale, currentRect, hoveredRegion, hoveredLocation]);

  useEffect(() => {
    const handleResize = () => {
      calculateScale();
    };
    window.addEventListener('resize', handleResize);
    calculateScale();
    return () => window.removeEventListener('resize', handleResize);
  }, [screenshot]);

  const calculateScale = () => {
    if (!containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth - 40; // padding
    const containerHeight = containerRef.current.clientHeight - 40;
    const scaleX = containerWidth / screenshot.width;
    const scaleY = containerHeight / screenshot.height;
    const newScale = Math.min(scaleX, scaleY, 1);

    setScale(newScale);
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = screenshot.width * scale;
    canvas.height = screenshot.height * scale;

    // Draw image
    const img = new window.Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Draw existing regions
      screenshot.regions.forEach(region => {
        const isHovered = hoveredRegion?.id === region.id;
        ctx.strokeStyle = region.type === 'StateRegion'
          ? (isHovered ? '#10b981' : 'rgba(16, 185, 129, 0.7)')  // green
          : (isHovered ? '#eab308' : 'rgba(234, 179, 8, 0.7)');   // yellow for SearchRegion
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.strokeRect(
          region.bounds.x * scale,
          region.bounds.y * scale,
          region.bounds.width * scale,
          region.bounds.height * scale
        );

        // Draw label background
        ctx.font = '12px sans-serif';
        const textMetrics = ctx.measureText(region.name);
        const textHeight = 16;
        const padding = 4;

        ctx.fillStyle = region.type === 'StateRegion'
          ? 'rgba(16, 185, 129, 0.9)'
          : 'rgba(234, 179, 8, 0.9)';
        ctx.fillRect(
          region.bounds.x * scale,
          region.bounds.y * scale - textHeight - padding,
          textMetrics.width + padding * 2,
          textHeight
        );

        // Draw label text
        ctx.fillStyle = 'white';
        ctx.fillText(
          region.name,
          region.bounds.x * scale + padding,
          region.bounds.y * scale - padding - 2
        );
      });

      // Draw existing locations
      screenshot.locations.forEach(location => {
        const isHovered = hoveredLocation?.id === location.id;
        const x = location.x * scale;
        const y = location.y * scale;
        const size = isHovered ? 15 : 10;

        // Draw crosshair
        ctx.strokeStyle = isHovered ? '#ef4444' : 'rgba(239, 68, 68, 0.8)';
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(x - size, y);
        ctx.lineTo(x + size, y);
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y + size);
        ctx.stroke();

        // Draw center dot
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Draw label
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.fillRect(x + 15, y - 10, ctx.measureText(location.name).width + 8, 16);
        ctx.fillStyle = 'white';
        ctx.font = '12px sans-serif';
        ctx.fillText(location.name, x + 19, y + 2);
      });

      // Draw current selection
      if (isDrawing && startPoint && currentRect) {
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          currentRect.x * scale,
          currentRect.y * scale,
          currentRect.width * scale,
          currentRect.height * scale
        );
        ctx.setLineDash([]);

        // Show dimensions
        ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
        const dimText = `${Math.round(currentRect.width)} x ${Math.round(currentRect.height)}`;
        const textWidth = ctx.measureText(dimText).width;
        ctx.fillRect(
          currentRect.x * scale + currentRect.width * scale - textWidth - 8,
          currentRect.y * scale + currentRect.height * scale - 20,
          textWidth + 8,
          16
        );
        ctx.fillStyle = 'white';
        ctx.fillText(
          dimText,
          currentRect.x * scale + currentRect.width * scale - textWidth - 4,
          currentRect.y * scale + currentRect.height * scale - 6
        );
      }
    };
    img.src = screenshot.imageData;
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectionMode === 'view') {
      // Check if clicking on existing region or location
      const coords = getCanvasCoordinates(e);

      // Check regions
      const clickedRegion = screenshot.regions.find(r =>
        coords.x >= r.bounds.x &&
        coords.x <= r.bounds.x + r.bounds.width &&
        coords.y >= r.bounds.y &&
        coords.y <= r.bounds.y + r.bounds.height
      );

      if (clickedRegion) {
        onRegionSelect(clickedRegion);
        return;
      }

      // Check locations
      const clickedLocation = screenshot.locations.find(l => {
        const distance = Math.sqrt(Math.pow(coords.x - l.x, 2) + Math.pow(coords.y - l.y, 2));
        return distance < 10;
      });

      if (clickedLocation) {
        onLocationSelect(clickedLocation);
        return;
      }

      onRegionSelect(null);
      onLocationSelect(null);
      return;
    }

    const coords = getCanvasCoordinates(e);

    if (selectionMode === 'location') {
      onLocationCreate({
        id: generateId(),
        screenshotId: screenshot.id,
        stateId: screenshot.associatedStates[0] || '', // Use first associated state or empty
        name: `Location_${screenshot.locations.length + 1}`,
        x: Math.round(coords.x),
        y: Math.round(coords.y)
      });
    } else if (selectionMode === 'region') {
      setIsDrawing(true);
      setStartPoint(coords);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);

    // Check hover states
    if (selectionMode === 'view') {
      // Check if hovering over region
      const hoverRegion = screenshot.regions.find(r =>
        coords.x >= r.bounds.x &&
        coords.x <= r.bounds.x + r.bounds.width &&
        coords.y >= r.bounds.y &&
        coords.y <= r.bounds.y + r.bounds.height
      );
      setHoveredRegion(hoverRegion || null);

      // Check if hovering over location
      const hoverLocation = screenshot.locations.find(l => {
        const distance = Math.sqrt(Math.pow(coords.x - l.x, 2) + Math.pow(coords.y - l.y, 2));
        return distance < 10;
      });
      setHoveredLocation(hoverLocation || null);
    }

    if (!isDrawing || !startPoint) return;

    const newRect = new DOMRect(
      Math.min(startPoint.x, coords.x),
      Math.min(startPoint.y, coords.y),
      Math.abs(coords.x - startPoint.x),
      Math.abs(coords.y - startPoint.y)
    );

    setCurrentRect(newRect);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentRect || !startPoint) return;

    // Only create region if it has meaningful size
    if (currentRect.width > 5 && currentRect.height > 5) {
      onRegionCreate({
        id: generateId(),
        screenshotId: screenshot.id,
        stateId: screenshot.associatedStates[0] || '', // Use first associated state or empty
        name: `Region_${screenshot.regions.length + 1}`,
        type: 'StateRegion',
        bounds: {
          x: Math.round(currentRect.x),
          y: Math.round(currentRect.y),
          width: Math.round(currentRect.width),
          height: Math.round(currentRect.height)
        }
      });
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentRect(null);
  };

  const getCursor = () => {
    if (selectionMode === 'view') {
      if (hoveredRegion || hoveredLocation) return 'pointer';
      return 'default';
    }
    if (selectionMode === 'location') return 'crosshair';
    if (selectionMode === 'region') return 'crosshair';
    return 'default';
  };

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center bg-gray-100 p-5 overflow-auto">
      <div className="relative">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            handleMouseUp();
            setHoveredRegion(null);
            setHoveredLocation(null);
          }}
          className="border border-gray-300 shadow-lg"
          style={{ cursor: getCursor() }}
        />
        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
          {Math.round(scale * 100)}% | {screenshot.width} x {screenshot.height}px
        </div>
        {selectionMode !== 'view' && (
          <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded text-xs">
            {selectionMode === 'region' ? 'Click and drag to create region' : 'Click to place location'}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScreenshotCanvas;
