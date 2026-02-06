import React, { useEffect, useRef, useState } from "react";

interface StateImageDisplayProps {
  image: string; // Base64 data URL
  mask?: string; // Base64 data URL of mask (white = visible, black = transparent)
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Component to display a StateImage with optional mask applied
 * If mask is provided, it composites the image with transparency based on the mask
 */
export const StateImageDisplay: React.FC<StateImageDisplayProps> = ({
  image,
  mask,
  alt = "State Image",
  className = "",
  style = {},
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!image) {
      setIsLoading(false);
      return;
    }

    const loadAndComposite = async () => {
      setIsLoading(true);

      try {
        // Load the main image
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = image;
        });

        console.log("[StateImageDisplay] Image loaded:", {
          width: img.width,
          height: img.height,
          hasMask: !!mask,
        });
        setDimensions({ width: img.width, height: img.height });

        // If no mask, just display the image normally
        if (!mask) {
          console.log("[StateImageDisplay] No mask, displaying image directly");
          setIsLoading(false);
          return;
        }

        console.log("[StateImageDisplay] Loading mask...");

        // Load the mask
        const maskImg = new Image();
        let maskLoadedSuccessfully = false;
        await new Promise<void>((resolve) => {
          maskImg.onload = () => {
            console.log("[StateImageDisplay] Mask loaded:", {
              width: maskImg.width,
              height: maskImg.height,
            });
            maskLoadedSuccessfully = true;
            resolve();
          };
          maskImg.onerror = (e) => {
            console.warn(
              "[StateImageDisplay] Failed to load mask, displaying image without mask",
              e
            );
            resolve(); // Continue without mask
          };
          maskImg.src = mask;
        });

        // If mask didn&apos;t load, just show image without mask
        if (
          !maskLoadedSuccessfully ||
          maskImg.width === 0 ||
          maskImg.height === 0
        ) {
          console.log(
            "[StateImageDisplay] Mask invalid, showing image without mask processing"
          );
          setIsLoading(false);
          return;
        }

        // Composite image with mask on canvas
        const canvas = canvasRef.current;
        if (!canvas) {
          console.warn("[StateImageDisplay] Canvas ref not available");
          setIsLoading(false);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          console.warn("[StateImageDisplay] Could not get 2d context");
          setIsLoading(false);
          return;
        }

        // Draw the main image
        ctx.drawImage(img, 0, 0);

        // Apply mask as alpha channel
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = maskImg.width;
        maskCanvas.height = maskImg.height;
        const maskCtx = maskCanvas.getContext("2d");

        if (maskCtx) {
          maskCtx.drawImage(maskImg, 0, 0);
          const maskData = maskCtx.getImageData(
            0,
            0,
            maskImg.width,
            maskImg.height
          );

          console.log(
            "[StateImageDisplay] Applying mask. Image pixels:",
            imageData.data.length / 4,
            "Mask pixels:",
            maskData.data.length / 4
          );

          // Sample first few pixels to debug
          console.log("[StateImageDisplay] Sample mask values:", [
            maskData.data[0],
            maskData.data[4],
            maskData.data[8],
            maskData.data[12],
          ]);

          // Apply mask to alpha channel (white = opaque, black = transparent)
          // Multiply existing alpha by mask value
          for (let i = 0; i < imageData.data.length; i += 4) {
            const maskIndex = i;
            // Use red channel of mask as alpha multiplier (grayscale mask)
            const maskValue = (maskData.data[maskIndex] ?? 0) / 255; // Normalize to 0-1
            const currentAlpha = imageData.data[i + 3];
            // Multiply current alpha by mask value
            imageData.data[i + 3] = (currentAlpha ?? 1) * maskValue;
          }

          console.log("[StateImageDisplay] Mask applied successfully");
          ctx.putImageData(imageData, 0, 0);
        } else {
          console.warn(
            "[StateImageDisplay] Mask context or dimensions invalid"
          );
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error loading StateImage:", error);
        setIsLoading(false);
      }
    };

    loadAndComposite();
  }, [image, mask]);

  if (!image) {
    return (
      <div
        className={`${className} bg-surface-raised flex items-center justify-center`}
        style={style}
      >
        <span className="text-text-muted text-xs">No image</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={`${className} bg-surface-raised flex items-center justify-center`}
        style={style}
      >
        <span className="text-text-muted text-xs">Loading...</span>
      </div>
    );
  }

  // If there&apos;s a mask, show the canvas
  if (mask && dimensions) {
    return (
      <div
        className={className}
        style={{
          ...style,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            imageRendering: "auto",
          }}
        />
      </div>
    );
  }

  // No mask, just show the image
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt={alt}
      className={className}
      style={{
        ...style,
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }}
    />
  );
};
