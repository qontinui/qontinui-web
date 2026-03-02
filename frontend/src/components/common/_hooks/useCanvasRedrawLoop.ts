import {
  useCallback,
  useEffect,
  type RefObject,
  type DependencyList,
} from "react";

interface UseCanvasRedrawLoopOptions {
  /** Ref to the canvas element. */
  canvasRef: RefObject<HTMLCanvasElement | null>;

  /**
   * Ref to the container element. When provided, the canvas is automatically
   * resized to match the container on window resize (and on mount).
   * Omit if the caller manages canvas sizing itself.
   */
  containerRef?: RefObject<HTMLDivElement | null>;

  /**
   * The domain-specific draw function. Receives a ready-to-use 2D context and
   * the canvas element. Called on every redraw (dependency change + resize).
   */
  draw: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void;

  /**
   * Dependency list for the draw callback. The draw function is memoized with
   * these deps via useCallback, so list every value the draw body reads.
   */
  deps: DependencyList;
}

/**
 * Shared canvas redraw loop that eliminates the duplicated scaffolding across
 * multiple `useCanvasRenderer` hooks. Handles:
 *
 * - Memoizing the draw callback with the caller's dependency list
 * - Triggering a redraw whenever dependencies change
 * - Listening for window resize events (and optionally resizing the canvas
 *   buffer to match a container element)
 *
 * The caller is responsible for all domain-specific drawing (clearing,
 * transforms, shapes, images, etc.) inside the `draw` function.
 *
 * Returns a `redraw` function that the caller can invoke imperatively
 * (e.g. after an async image load completes).
 */
export function useCanvasRedrawLoop({
  canvasRef,
  containerRef,
  draw,
  deps,
}: UseCanvasRedrawLoopOptions): { redraw: () => void } {
  // Memoize the draw callback with the caller's dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedDraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    draw(ctx, canvas);
  }, deps);

  // Redraw whenever the memoized draw callback identity changes.
  useEffect(() => {
    memoizedDraw();
  }, [memoizedDraw]);

  // Resize canvas to container on window resize (when containerRef provided).
  useEffect(() => {
    const handleResize = () => {
      if (containerRef) {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (container && canvas) {
          canvas.width = container.clientWidth;
          canvas.height = container.clientHeight;
        }
      }
      memoizedDraw();
    };

    // Initial sizing + draw.
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [memoizedDraw, containerRef, canvasRef]);

  return { redraw: memoizedDraw };
}
