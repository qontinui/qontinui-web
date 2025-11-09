import React, { useRef, useState, useEffect } from 'react';
import { Screenshot, ScreenshotRegion, ScreenshotLocation, SelectionMode } from '../../types/Screenshot';
import { generateId } from '../../lib/utils';
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react';

interface ScreenshotCanvasProps {
  screenshot: Screenshot;
  selectionMode: SelectionMode;
  zoomMode: 'fit' | 'original';
  onRegionCreate: (region: ScreenshotRegion) => void;
  onLocationCreate: (location: ScreenshotLocation) => void;
  onRegionSelect: (region: ScreenshotRegion | null) => void;
  onLocationSelect: (location: ScreenshotLocation | null) => void;
}

const ScreenshotCanvas: React.FC<ScreenshotCanvasProps> = ({
  screenshot,
  selectionMode,
  zoomMode,
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
  const [manualZoom, setManualZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredRegion, setHoveredRegion] = useState<ScreenshotRegion | null>(null);
  const [hoveredLocation, setHoveredLocation] = useState<ScreenshotLocation | null>(null);

  useEffect(() => {
    drawCanvas();
  }, [screenshot, scale, manualZoom, offset, currentRect, hoveredRegion, hoveredLocation]);

  useEffect(() => {
    const handleResize = () => {
      calculateScale();
    };
    window.addEventListener('resize', handleResize);

    // Use requestAnimationFrame to ensure container is measured after layout
    requestAnimationFrame(() => {
      calculateScale();
    });

    return () => window.removeEventListener('resize', handleResize);
  }, [screenshot, zoomMode]);

  // Reset offset when changing zoom
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [manualZoom]);

  const calculateScale = () => {
    if (!containerRef.current) {
      // Retry after a short delay if container not ready
      setTimeout(() => calculateScale(), 100);
      return;
    }

    if (zoomMode === 'original') {
      setScale(1);
      return;
    }

    const containerWidth = containerRef.current.clientWidth - 40; // padding
    const containerHeight = containerRef.current.clientHeight - 40;

    if (containerWidth <= 0 || containerHeight <= 0) {
      // Container not sized yet, retry
      setTimeout(() => calculateScale(), 100);
      return;
    }

    const scaleX = containerWidth / screenshot.width;
    const scaleY = containerHeight / screenshot.height;
    const newScale = Math.min(scaleX, scaleY, 1);

    setScale(newScale);
  };

  const handleZoomIn = () => {
    setManualZoom(prev => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setManualZoom(prev => Math.max(prev / 1.2, 0.1));
  };

  const handleResetZoom = () => {
    setManualZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const getEffectiveScale = () => {
    return scale * manualZoom;
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const effectiveScale = getEffectiveScale();

    // Set canvas size
    canvas.width = screenshot.width * effectiveScale;
    canvas.height = screenshot.height * effectiveScale;

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
          region.bounds.x * effectiveScale,
          region.bounds.y * effectiveScale,
          region.bounds.width * effectiveScale,
          region.bounds.height * effectiveScale
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
          region.bounds.x * effectiveScale,
          region.bounds.y * effectiveScale - textHeight - padding,
          textMetrics.width + padding * 2,
          textHeight
        );

        // Draw label text
        ctx.fillStyle = 'white';
        ctx.fillText(
          region.name,
          region.bounds.x * effectiveScale + padding,
          region.bounds.y * effectiveScale - padding - 2
        );
      });

      // Draw existing locations
      screenshot.locations.forEach(location => {
        const isHovered = hoveredLocation?.id === location.id;
        const x = location.x * effectiveScale;
        const y = location.y * effectiveScale;
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
          currentRect.x * effectiveScale,
          currentRect.y * effectiveScale,
          currentRect.width * effectiveScale,
          currentRect.height * effectiveScale
        );
        ctx.setLineDash([]);

        // Show dimensions
        ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
        const dimText = `${Math.round(currentRect.width)} x ${Math.round(currentRect.height)}`;
        const textWidth = ctx.measureText(dimText).width;
        ctx.fillRect(
          currentRect.x * effectiveScale + currentRect.width * effectiveScale - textWidth - 8,
          currentRect.y * effectiveScale + currentRect.height * effectiveScale - 20,
          textWidth + 8,
          16
        );
        ctx.fillStyle = 'white';
        ctx.fillText(
          dimText,
          currentRect.x * effectiveScale + currentRect.width * effectiveScale - textWidth - 4,
          currentRect.y * effectiveScale + currentRect.height * effectiveScale - 6
        );
      }
    };
    img.src = screenshot.imageData;
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const effectiveScale = getEffectiveScale();

    // Convert from canvas pixel coordinates to original screenshot coordinates
    return {
      x: (e.clientX - rect.left) / effectiveScale,
      y: (e.clientY - rect.top) / effectiveScale
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Right-click for panning
    if (e.button === 2) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    // Left-click for mode-specific actions
    if (e.button === 0) {
      const coords = getCanvasCoordinates(e);

      if (selectionMode === 'view') {
        // Check if clicking on existing region or location
        // Check regions
        const clickedRegion = screenshot.regions.find(r =>
          coords.x >= r.bounds.x &&
          coords.x <= r.bounds.x + r.bounds.width &&
          coords.y >= r.bounds.y &&
          coords.y <= r.bounds.y + r.bounds.height
        );

        if (clickedRegion) {
          onRegionSelect(clickedRegion);
          onLocationSelect(null); // Deselect location when region is selected
          return;
        }

        // Check locations
        const clickedLocation = screenshot.locations.find(l => {
          const distance = Math.sqrt(Math.pow(coords.x - l.x, 2) + Math.pow(coords.y - l.y, 2));
          return distance < 10;
        });

        if (clickedLocation) {
          onLocationSelect(clickedLocation);
          onRegionSelect(null); // Deselect region when location is selected
          return;
        }

        onRegionSelect(null);
        onLocationSelect(null);
        return;
      }

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
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle dragging
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
      return;
    }

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
    // Stop dragging
    if (isDragging) {
      setIsDragging(false);
      return;
    }

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
    if (isDragging) return 'grabbing';
    if (selectionMode === 'view') {
      if (hoveredRegion || hoveredLocation) return 'pointer';
      return 'default';
    }
    if (selectionMode === 'location') return 'crosshair';
    if (selectionMode === 'region') return 'crosshair';
    return 'default';
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-100 min-h-0 relative">
      {/* Top Bar with Mode Indicator and Zoom Controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 text-white px-3 py-1 rounded text-sm">
            {selectionMode === 'view' && 'Left Click: Select annotation • Right Click: Pan'}
            {selectionMode === 'region' && 'Left Click: Draw region • Right Click: Pan'}
            {selectionMode === 'location' && 'Left Click: Place location • Right Click: Pan'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-gray-800 text-white px-3 py-1 rounded text-sm">
            {Math.round(getEffectiveScale() * 100)}% | {screenshot.width} x {screenshot.height}px
          </div>
          <div className="flex gap-1 bg-white rounded-lg shadow border border-gray-300 p-1">
            <button
              onClick={handleZoomIn}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4 text-gray-700" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4 text-gray-700" />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
              title="Reset Zoom"
            >
              <Maximize2 className="w-4 h-4 text-gray-700" />
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div ref={containerRef} className="flex-1 overflow-auto min-h-0">
        <div className="p-5">
          <div className="relative inline-block">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                handleMouseUp();
                setHoveredRegion(null);
                setHoveredLocation(null);
                setIsDragging(false);
              }}
              onContextMenu={(e) => e.preventDefault()}
              className="border border-gray-300 shadow-lg bg-white"
              style={{
                cursor: getCursor(),
                transform: `translate(${offset.x}px, ${offset.y}px)`
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScreenshotCanvas;
