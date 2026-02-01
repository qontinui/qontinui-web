"use client";

import React, { useEffect, useState } from "react";
import { patternOptimizationStorage } from "@/lib/pattern-optimization-storage";
import { ImageIcon } from "lucide-react";

interface ScreenshotImageProps {
  screenshotId: string;
  fallbackUrl?: string;
  alt?: string;
  className?: string;
}

export function ScreenshotImage({
  screenshotId,
  fallbackUrl,
  alt = "Screenshot",
  className = "",
}: ScreenshotImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(false);

        // Try to get image from IndexedDB
        const storedImage =
          await patternOptimizationStorage.getImage(screenshotId);

        if (mounted) {
          if (storedImage) {
            setImageUrl(storedImage);
          } else if (fallbackUrl) {
            // Use fallback URL if provided
            setImageUrl(fallbackUrl);
          } else {
            setError(true);
          }
        }
      } catch (err) {
        console.error(`Failed to load image ${screenshotId}:`, err);
        if (mounted) {
          setError(true);
          if (fallbackUrl) {
            setImageUrl(fallbackUrl);
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [screenshotId, fallbackUrl]);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-raised ${className}`}
      >
        <div className="animate-pulse">
          <ImageIcon className="w-8 h-8 text-text-muted" />
        </div>
      </div>
    );
  }

  if (error && !imageUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-raised ${className}`}
      >
        <ImageIcon className="w-8 h-8 text-text-muted" />
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- Using data URLs from IndexedDB which aren't supported by next/image
  return <img src={imageUrl || ""} alt={alt} className={className} />;
}
