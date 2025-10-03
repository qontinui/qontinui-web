import React, { useEffect, useRef, useState } from 'react';
import { StateImageRenderer, RenderMode } from '@/lib/state-image-renderer';

export interface StateImageViewerProps {
  image: string; // Base64 data URL
  mask?: string; // Base64 data URL
  mode?: RenderMode;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Component to display a StateImage using the StateImageRenderer
 */
export const StateImageViewer: React.FC<StateImageViewerProps> = ({
  image,
  mask,
  mode = 'normal',
  alt = 'State Image',
  className = '',
  style = {},
  onLoad,
  onError
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StateImageRenderer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadAndRender = async () => {
      if (!image) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Create renderer if needed
        if (!rendererRef.current) {
          rendererRef.current = new StateImageRenderer();
        }

        const renderer = rendererRef.current;

        // Load image and mask
        await renderer.load({ image, mask });

        if (!mounted) return;

        // Determine render mode based on mask availability
        let renderMode = mode;

        // If mode is 'with-mask' but no mask available, fall back to 'normal'
        if (mode === 'with-mask' && !renderer.hasMask()) {
          console.log('[StateImageViewer] No mask available, rendering in normal mode');
          renderMode = 'normal';
        }

        // If mode is 'mask-only' but no mask available, show empty
        if (mode === 'mask-only' && !renderer.hasMask()) {
          console.log('[StateImageViewer] No mask available for mask-only mode');
        }

        // Render
        const canvas = renderer.render(renderMode);

        if (!mounted) return;

        setCanvasElement(canvas);
        setIsLoading(false);

        if (onLoad) {
          onLoad();
        }
      } catch (err) {
        if (!mounted) return;

        const error = err instanceof Error ? err : new Error('Failed to load image');
        setError(error);
        setIsLoading(false);

        if (onError) {
          onError(error);
        }
      }
    };

    loadAndRender();

    return () => {
      mounted = false;
    };
  }, [image, mask, mode, onLoad, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  if (!image) {
    return (
      <div
        className={`${className} bg-gray-800 flex items-center justify-center`}
        style={style}
      >
        <span className="text-gray-500 text-xs">No image</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`${className} bg-red-900 flex items-center justify-center`}
        style={style}
      >
        <span className="text-red-300 text-xs">Error loading image</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={`${className} bg-gray-800 flex items-center justify-center`}
        style={style}
      >
        <span className="text-gray-500 text-xs">Loading...</span>
      </div>
    );
  }

  if (!canvasElement) {
    return (
      <div
        className={`${className} bg-gray-800 flex items-center justify-center`}
        style={style}
      >
        <span className="text-gray-500 text-xs">No canvas</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...style,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <canvas
        ref={(node) => {
          if (node && canvasElement) {
            // Copy canvas content to the DOM canvas
            node.width = canvasElement.width;
            node.height = canvasElement.height;
            const ctx = node.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(canvasElement, 0, 0);
            }
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          imageRendering: 'crisp-edges'
        }}
        aria-label={alt}
      />
    </div>
  );
};
