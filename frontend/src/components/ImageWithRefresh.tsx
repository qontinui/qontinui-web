"use client";

import { useState, useEffect, useCallback } from "react";
import { ImageAsset } from "@/contexts/automation-context/types";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

interface ImageWithRefreshProps {
  imageAsset: ImageAsset;
  projectId: number;
  alt: string;
  className?: string;
  onRefresh?: (newUrl: string) => void;
}

/**
 * ImageWithRefresh - Auto-refreshing image component for S3 presigned URLs
 *
 * Features:
 * - Checks if URL is expiring within 1 hour
 * - Auto-refreshes presigned URL when needed
 * - Handles image load errors by attempting refresh
 * - Shows loading state during refresh
 */
export function ImageWithRefresh({
  imageAsset,
  projectId,
  alt,
  className = "",
  onRefresh,
}: ImageWithRefreshProps) {
  const [currentUrl, setCurrentUrl] = useState(imageAsset.url);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Check if URL is expiring within 1 hour (3600000ms)
  const isUrlExpiringSoon = useCallback(() => {
    if (!imageAsset.url_expires_at) return false;

    const expiresAt = new Date(imageAsset.url_expires_at).getTime();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

    return expiresAt - now < oneHour;
  }, [imageAsset.url_expires_at]);

  // Refresh the presigned URL
  const refreshUrl = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    setImageError(false);

    try {
      const response = await apiClient.refreshPresignedUrl(
        projectId,
        imageAsset.s3_key ?? ""
      );

      setCurrentUrl(response.url);

      // Notify parent component
      if (onRefresh) {
        onRefresh(response.url);
      }

      console.log(`[ImageWithRefresh] Refreshed URL for ${imageAsset.name}`);
    } catch (error) {
      console.error("[ImageWithRefresh] Failed to refresh URL:", error);
      toast.error("Failed to refresh image URL", {
        description: "Please try reloading the page.",
      });
      setImageError(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, imageAsset.s3_key, imageAsset.name, onRefresh, isRefreshing]);

  // Check URL expiry on mount and periodically
  useEffect(() => {
    // Check immediately on mount
    if (isUrlExpiringSoon()) {
      refreshUrl();
    }

    // Check every 30 minutes
    const interval = setInterval(
      () => {
        if (isUrlExpiringSoon()) {
          refreshUrl();
        }
      },
      30 * 60 * 1000
    ); // 30 minutes

    return () => clearInterval(interval);
  }, [isUrlExpiringSoon, refreshUrl]);

  // Handle image load error
  const handleImageError = useCallback(() => {
    console.warn(
      `[ImageWithRefresh] Image load error for ${imageAsset.name}, attempting refresh...`
    );
    setImageError(true);
    refreshUrl();
  }, [imageAsset.name, refreshUrl]);

  // Update current URL when imageAsset changes
  useEffect(() => {
    setCurrentUrl(imageAsset.url);
    setImageError(false);
  }, [imageAsset.url]);

  if (isRefreshing && imageError) {
    return (
      <div
        className={`bg-surface-raised rounded flex items-center justify-center ${className}`}
        role="status"
        aria-live="polite"
        aria-label="Refreshing image"
      >
        <div className="text-center p-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto mb-2"></div>
          <p className="text-xs text-text-muted">Refreshing...</p>
        </div>
      </div>
    );
  }

  if (imageError && !isRefreshing) {
    return (
      <div
        className={`bg-surface-raised rounded flex items-center justify-center ${className}`}
        role="alert"
        aria-label="Failed to load image"
      >
        <div className="text-center p-4">
          <p className="text-xs text-red-400 mb-2">Failed to load image</p>
          <button
            onClick={refreshUrl}
            className="text-xs text-brand-primary hover:text-brand-primary/80 underline"
            aria-label="Retry loading image"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <img
      src={currentUrl}
      alt={alt}
      className={className}
      onError={handleImageError}
      loading="lazy"
    />
  );
}
