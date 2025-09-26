import React, { useRef, useEffect, useState } from 'react';
import { Screenshot } from '../../types/Screenshot';
import { Eye, Search, Target } from 'lucide-react';

interface MatchRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  label?: string;
  color?: string;
}

interface MatchVisualizationProps {
  screenshot: Screenshot;
  matches: MatchRegion[];
  showScores?: boolean;
  showLabels?: boolean;
  highlightBest?: boolean;
}

const MatchVisualization: React.FC<MatchVisualizationProps> = ({
  screenshot,
  matches,
  showScores = true,
  showLabels = true,
  highlightBest = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [hoveredMatch, setHoveredMatch] = useState<MatchRegion | null>(null);

  useEffect(() => {
    drawVisualization();
  }, [screenshot, matches, scale, hoveredMatch]);

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

    const containerWidth = containerRef.current.clientWidth - 40;
    const containerHeight = containerRef.current.clientHeight - 40;
    const scaleX = containerWidth / screenshot.width;
    const scaleY = containerHeight / screenshot.height;
    const newScale = Math.min(scaleX, scaleY, 1);

    setScale(newScale);
  };

  const drawVisualization = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = screenshot.width * scale;
    canvas.height = screenshot.height * scale;

    // Draw screenshot
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Sort matches by score to draw best ones on top
      const sortedMatches = [...matches].sort((a, b) => a.score - b.score);

      // Draw each match
      sortedMatches.forEach((match, index) => {
        const isBest = highlightBest && index === sortedMatches.length - 1;
        const isHovered = hoveredMatch === match;

        // Calculate scaled positions
        const x = match.x * scale;
        const y = match.y * scale;
        const width = match.width * scale;
        const height = match.height * scale;

        // Determine color
        let color = match.color || '#00ff00'; // Default green
        if (isBest) color = '#ffff00'; // Yellow for best
        if (isHovered) color = '#ff00ff'; // Magenta for hovered

        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = isHovered || isBest ? 3 : 2;
        ctx.strokeRect(x, y, width, height);

        // Draw semi-transparent fill
        ctx.fillStyle = color + '20'; // Add alpha
        ctx.fillRect(x, y, width, height);

        // Draw corner markers
        const markerSize = 8;
        ctx.fillStyle = color;
        // Top-left
        ctx.fillRect(x - markerSize/2, y - markerSize/2, markerSize, markerSize);
        // Top-right
        ctx.fillRect(x + width - markerSize/2, y - markerSize/2, markerSize, markerSize);
        // Bottom-left
        ctx.fillRect(x - markerSize/2, y + height - markerSize/2, markerSize, markerSize);
        // Bottom-right
        ctx.fillRect(x + width - markerSize/2, y + height - markerSize/2, markerSize, markerSize);

        // Draw label and score
        if (showLabels || showScores) {
          const labelParts: string[] = [];
          if (showLabels && match.label) {
            labelParts.push(match.label);
          }
          if (showScores) {
            labelParts.push(`${(match.score * 100).toFixed(1)}%`);
          }

          if (labelParts.length > 0) {
            const label = labelParts.join(' - ');
            ctx.font = `${12 * scale}px sans-serif`;
            const textMetrics = ctx.measureText(label);
            const textHeight = 16 * scale;
            const padding = 4 * scale;

            // Draw label background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(
              x,
              y - textHeight - padding * 2,
              textMetrics.width + padding * 2,
              textHeight + padding
            );

            // Draw label text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x + padding, y - padding - 2);
          }
        }

        // Draw center crosshair for hovered match
        if (isHovered) {
          const centerX = x + width / 2;
          const centerY = y + height / 2;
          const crosshairSize = 20;

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(centerX - crosshairSize, centerY);
          ctx.lineTo(centerX + crosshairSize, centerY);
          ctx.moveTo(centerX, centerY - crosshairSize);
          ctx.lineTo(centerX, centerY + crosshairSize);
          ctx.stroke();
        }
      });

      // Draw statistics overlay
      if (matches.length > 0) {
        const stats = {
          total: matches.length,
          avgScore: matches.reduce((sum, m) => sum + m.score, 0) / matches.length,
          bestScore: Math.max(...matches.map(m => m.score))
        };

        // Draw stats background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 200, 80);

        // Draw stats text
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.fillText(`Matches: ${stats.total}`, 20, 30);
        ctx.fillText(`Best: ${(stats.bestScore * 100).toFixed(1)}%`, 20, 50);
        ctx.fillText(`Average: ${(stats.avgScore * 100).toFixed(1)}%`, 20, 70);
      }
    };
    img.src = screenshot.imageData;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    // Check if hovering over any match
    const hovered = matches.find(match =>
      x >= match.x &&
      x <= match.x + match.width &&
      y >= match.y &&
      y <= match.y + match.height
    );

    setHoveredMatch(hovered || null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium">Match Visualization</span>
          <span className="text-sm text-gray-600">
            ({matches.length} matches found)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={showScores}
              onChange={(e) => {/* Toggle showScores */}}
              className="w-4 h-4"
            />
            Scores
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => {/* Toggle showLabels */}}
              className="w-4 h-4"
            />
            Labels
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={highlightBest}
              onChange={(e) => {/* Toggle highlightBest */}}
              className="w-4 h-4"
            />
            Highlight Best
          </label>
        </div>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-gray-100 p-5 overflow-auto"
      >
        <div className="relative">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredMatch(null)}
            className="border border-gray-300 shadow-lg cursor-crosshair"
          />

          {/* Scale indicator */}
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
            {Math.round(scale * 100)}%
          </div>

          {/* Hovered match info */}
          {hoveredMatch && (
            <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white p-2 rounded text-sm">
              <div>Score: {(hoveredMatch.score * 100).toFixed(1)}%</div>
              <div>Position: ({hoveredMatch.x}, {hoveredMatch.y})</div>
              <div>Size: {hoveredMatch.width} × {hoveredMatch.height}</div>
              {hoveredMatch.label && <div>Label: {hoveredMatch.label}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Match List */}
      <div className="border-t bg-white max-h-48 overflow-y-auto">
        <div className="p-2">
          <h3 className="text-sm font-medium mb-2">Match Details</h3>
          <div className="space-y-1">
            {matches
              .sort((a, b) => b.score - a.score)
              .map((match, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between p-2 text-xs rounded cursor-pointer transition-colors ${
                    hoveredMatch === match ? 'bg-blue-100' : 'hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => setHoveredMatch(match)}
                  onMouseLeave={() => setHoveredMatch(null)}
                >
                  <div className="flex items-center gap-2">
                    <Target className="w-3 h-3" />
                    <span>Match #{index + 1}</span>
                    {match.label && (
                      <span className="text-gray-600">({match.label})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">
                      ({match.x}, {match.y})
                    </span>
                    <span className={`font-medium ${
                      match.score >= 0.9 ? 'text-green-600' :
                      match.score >= 0.8 ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {(match.score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MatchVisualization;
