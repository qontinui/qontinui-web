import React, { useCallback, useEffect, useRef, useState } from "react";

export function useTooltip(delay: number = 500) {
  const [isVisible, setIsVisible] = useState(false);
  const [content, setContent] = useState<React.ReactNode>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const show = useCallback(
    (tooltipContent: React.ReactNode) => {
      timeoutRef.current = setTimeout(() => {
        setContent(tooltipContent);
        setIsVisible(true);
      }, delay);
    },
    [delay]
  );

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    isVisible,
    content,
    show,
    hide,
  };
}
