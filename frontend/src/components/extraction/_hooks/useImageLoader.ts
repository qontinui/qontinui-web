"use client";

import { useEffect, useRef, useState } from "react";

export function useImageLoader(
  screenshotUrl: string | null,
  setScreenshot: (url: string, width: number, height: number) => void
) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (!screenshotUrl) {
      setImageLoaded(false);
      imageRef.current = null;
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setScreenshot(screenshotUrl, img.width, img.height);
      setImageLoaded(true);
    };
    img.onerror = () => {
      console.error("Failed to load screenshot");
      setImageLoaded(false);
    };
    img.src = screenshotUrl;
  }, [screenshotUrl, setScreenshot]);

  return { imageRef, imageLoaded };
}
