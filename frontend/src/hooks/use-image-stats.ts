import { useState, useEffect } from "react";

export interface ImageStats {
  width: number;
  height: number;
  transparencyPercent: number;
  isLoading: boolean;
}

/**
 * Calculate the percentage of transparent pixels in an image
 */
function calculateTransparency(imageData: ImageData): number {
  const pixels = imageData.data;
  let transparentPixels = 0;
  const totalPixels = imageData.width * imageData.height;

  // Check alpha channel (every 4th value in the data array)
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) {
      transparentPixels++;
    }
  }

  return (transparentPixels / totalPixels) * 100;
}

/**
 * Hook to get image statistics from a base64 data URL
 */
export function useImageStats(imageDataUrl: string | null): ImageStats | null {
  const [stats, setStats] = useState<ImageStats | null>(null);

  useEffect(() => {
    if (!imageDataUrl) {
      setStats(null);
      return;
    }

    setStats({ width: 0, height: 0, transparencyPercent: 0, isLoading: true });

    const img = new Image();
    img.onload = () => {
      try {
        // Create a canvas to analyze the image
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          setStats({
            width: img.width,
            height: img.height,
            transparencyPercent: 0,
            isLoading: false,
          });
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const transparencyPercent = calculateTransparency(imageData);

        setStats({
          width: img.width,
          height: img.height,
          transparencyPercent: Math.round(transparencyPercent * 10) / 10, // Round to 1 decimal
          isLoading: false,
        });
      } catch (error) {
        console.error("Error analyzing image:", error);
        setStats({
          width: img.width,
          height: img.height,
          transparencyPercent: 0,
          isLoading: false,
        });
      }
    };

    img.onerror = () => {
      setStats(null);
    };

    img.src = imageDataUrl;
  }, [imageDataUrl]);

  return stats;
}
