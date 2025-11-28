import React, { useState, useRef, useEffect, useCallback } from "react";
import { StateImage } from "../../types/stateDiscovery";
import { toast } from "sonner";

interface MaskVisualizationProps {
  stateImage: StateImage;
  maskData?: string; // Base64 encoded mask
  onMaskUpdate?: (maskData: string) => void;
  readOnly?: boolean;
}

export const MaskVisualization: React.FC<MaskVisualizationProps> = ({
  stateImage,
  maskData: initialMaskData,
  onMaskUpdate,
  readOnly = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [maskData, setMaskData] = useState(initialMaskData);
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.5);
  const [maskType, setMaskType] = useState<
    "full" | "stability" | "edge" | "saliency"
  >("full");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [maskMetadata, setMaskMetadata] = useState<any>(null);

  useEffect(() => {
    if (canvasRef.current && stateImage) {
      drawVisualization();
    }
  }, [stateImage, maskData, showMask, maskOpacity]);

  useEffect(() => {
    // Fetch mask if StateImage has one but we don't have the data
    if (stateImage.hasMask && !maskData && !isLoading) {
      fetchMask();
    }
  }, [stateImage.hasMask, stateImage.id]);

  const drawVisualization = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw state image placeholder (in production, would draw actual image)
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw StateImage info
    ctx.fillStyle = "#666";
    ctx.font = "12px sans-serif";
    ctx.fillText(stateImage.name, 10, 20);
    ctx.fillText(`${stateImage.width}x${stateImage.height}`, 10, 35);

    if (showMask && maskData) {
      // Draw mask overlay
      const img = new Image();
      img.onload = () => {
        ctx.globalAlpha = maskOpacity;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
      };
      img.src = maskData;
    } else if (showMask && stateImage.hasMask) {
      // Draw mask density indicator
      ctx.fillStyle = `rgba(0, 255, 0, ${maskOpacity})`;
      const maskWidth = canvas.width * (stateImage.maskDensity || 1.0);
      const maskHeight = canvas.height * (stateImage.maskDensity || 1.0);
      const x = (canvas.width - maskWidth) / 2;
      const y = (canvas.height - maskHeight) / 2;
      ctx.fillRect(x, y, maskWidth, maskHeight);
    }

    // Draw border
    ctx.strokeStyle = stateImage.hasMask ? "#4CAF50" : "#999";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  };

  const fetchMask = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/state-discovery/state-image/${stateImage.id}/mask`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.mask_data) {
          setMaskData(`data:image/png;base64,${data.mask_data}`);
          setMaskMetadata({
            density: data.mask_density,
            type: data.mask_type,
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch mask:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateMask = async () => {
    if (!stateImage.pixelHash) {
      toast.error("Cannot generate mask: StateImage needs pixel data");
      return;
    }

    setIsGenerating(true);
    try {
      // First, we need to get the actual image data
      // This would typically come from the screenshot or stored image

      // Generate mask through API
      const response = await fetch("/api/masks/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_data: "", // Would need actual base64 image data
          mask_type: maskType,
          stability_threshold: 0.95,
          edge_low_threshold: 50,
          edge_high_threshold: 150,
          saliency_threshold: 0.5,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newMaskData = `data:image/png;base64,${data.mask_data}`;
        setMaskData(newMaskData);
        setMaskMetadata({
          density: data.density,
          activePixels: data.active_pixels,
          totalPixels: data.total_pixels,
        });

        if (onMaskUpdate) {
          onMaskUpdate(newMaskData);
        }

        toast.success("Mask generated successfully");
      } else {
        toast.error("Failed to generate mask");
      }
    } catch (error) {
      console.error("Failed to generate mask:", error);
      toast.error("Error generating mask");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mask-visualization">
      <div className="mask-header flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-gray-700">
          Mask Visualization
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMask(!showMask)}
            className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
          >
            {showMask ? "Hide" : "Show"} Mask
          </button>
          {!readOnly && (
            <button
              onClick={generateMask}
              disabled={isGenerating}
              className="px-2 py-1 text-xs bg-blue-500 text-white hover:bg-blue-600 rounded disabled:opacity-50"
            >
              {isGenerating ? "Generating..." : "Generate"}
            </button>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={200}
        height={200}
        className="border border-gray-300 rounded mb-2"
      />

      <div className="mask-controls">
        {showMask && (
          <div className="mb-2">
            <label className="text-xs text-gray-600">
              Opacity: {Math.round(maskOpacity * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={maskOpacity * 100}
              onChange={(e) => setMaskOpacity(Number(e.target.value) / 100)}
              className="w-full"
            />
          </div>
        )}

        {!readOnly && (
          <div>
            <label className="text-xs text-gray-600">Mask Type:</label>
            <select
              value={maskType}
              onChange={(e) => setMaskType(e.target.value as any)}
              className="w-full text-xs border rounded px-1 py-0.5"
            >
              <option value="full">Full Rectangle</option>
              <option value="stability">Pixel Stability</option>
              <option value="edge">Edge Detection</option>
              <option value="saliency">Visual Saliency</option>
            </select>
          </div>
        )}

        {(stateImage.hasMask || maskMetadata) && (
          <div className="mt-2 text-xs text-gray-600">
            <div>
              Mask Density:{" "}
              {Math.round(
                (maskMetadata?.density || stateImage.maskDensity || 1.0) * 100
              )}
              %
            </div>
            <div>
              Active Pixels:{" "}
              {maskMetadata?.activePixels ||
                Math.round(
                  (stateImage.maskDensity || 1.0) *
                    stateImage.width *
                    stateImage.height
                )}
            </div>
            {maskMetadata?.type && <div>Type: {maskMetadata.type}</div>}
          </div>
        )}

        {isLoading && (
          <div className="mt-2 text-xs text-gray-500">Loading mask...</div>
        )}
      </div>
    </div>
  );
};
