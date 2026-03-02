import { useState, useRef, useEffect } from "react";
import { PULSE_ANIMATION_STYLES } from "../_components/annotated-image-types";

export function useImageScale() {
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const styleId = "annotated-image-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = PULSE_ANIMATION_STYLES;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    const handleImageLoad = () => {
      if (imgRef.current) {
        const naturalWidth = imgRef.current.naturalWidth;
        const displayWidth = imgRef.current.offsetWidth;
        if (displayWidth > 0) {
          setScale(displayWidth / naturalWidth);
        }
      }
    };

    const img = imgRef.current;
    if (img) {
      if (img.complete) {
        handleImageLoad();
      } else {
        img.addEventListener("load", handleImageLoad);
        return () => img.removeEventListener("load", handleImageLoad);
      }
    }
    return undefined;
  }, []);

  return { scale, imgRef };
}
