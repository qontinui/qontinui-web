/**
 * Canvas Performance Optimizations
 *
 * Features:
 * - Memoized selectors
 * - Debounced updates
 * - Throttled renders
 * - Virtual scrolling for large graphs
 * - Lazy node rendering
 * - Connection batching
 * - Performance monitoring
 */

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { Action, Workflow } from "../lib/action-schema/action-types";
import { createLogger } from "@/lib/logger";

const log = createLogger("CanvasPerformance");

// ============================================================================
// Debounce & Throttle Utilities
// ============================================================================

/**
 * Debounce function - delays execution until after wait time
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function - limits execution to once per wait time
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;

      setTimeout(() => {
        inThrottle = false;
      }, wait);
    }
  };
}

/**
 * Request animation frame throttle
 */
export function rafThrottle<T extends (...args: unknown[]) => unknown>(
  func: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;

  return function executedFunction(...args: Parameters<T>) {
    if (rafId !== null) {
      return;
    }

    rafId = requestAnimationFrame(() => {
      func(...args);
      rafId = null;
    });
  };
}

// ============================================================================
// React Hooks for Performance
// ============================================================================

/**
 * Hook for debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for throttled value
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdated = useRef(Date.now());

  useEffect(() => {
    const now = Date.now();

    if (now >= lastUpdated.current + interval) {
      lastUpdated.current = now;
      setThrottledValue(value);
      return;
    } else {
      const timer = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, interval);

      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

/**
 * Hook for debounced callback
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  );
}

/**
 * Hook for throttled callback
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const lastRan = useRef(Date.now());

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();

      if (now - lastRan.current >= delay) {
        callback(...args);
        lastRan.current = now;
      }
    },
    [callback, delay]
  );
}

// ============================================================================
// Memoized Selectors
// ============================================================================

/**
 * Memoized selector for action count
 */
export function useActionCount(workflow: Workflow | null): number {
  return useMemo(
    () => workflow?.actions.length ?? 0,
    [workflow?.actions.length]
  );
}

/**
 * Memoized selector for connection count
 */
export function useConnectionCount(workflow: Workflow | null): number {
  return useMemo(() => {
    if (!workflow) return 0;

    return Object.values(workflow.connections).reduce((count, sourceConn) => {
      return (
        count +
        Object.values(sourceConn).reduce((typeCount, outputs) => {
          return (
            typeCount +
            (outputs?.reduce((sum, arr) => sum + arr.length, 0) || 0)
          );
        }, 0)
      );
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.connections]);
}

/**
 * Memoized selector for actions by type
 */
export function useActionsByType(
  workflow: Workflow | null,
  type: string
): Action[] {
  return useMemo(() => {
    return workflow?.actions.filter((a) => a.type === type) ?? [];
  }, [workflow?.actions, type]);
}

/**
 * Memoized selector for action map
 */
export function useActionMap(workflow: Workflow | null): Map<string, Action> {
  return useMemo(() => {
    const map = new Map<string, Action>();
    workflow?.actions.forEach((action) => {
      map.set(action.id, action);
    });
    return map;
  }, [workflow?.actions]);
}

/**
 * Memoized selector for visible actions (viewport culling)
 */
export function useVisibleActions(
  actions: Action[],
  viewport: { x: number; y: number; zoom: number },
  canvasWidth: number,
  canvasHeight: number
): Action[] {
  return useMemo(() => {
    const visibleX = -viewport.x / viewport.zoom;
    const visibleY = -viewport.y / viewport.zoom;
    const visibleWidth = canvasWidth / viewport.zoom;
    const visibleHeight = canvasHeight / viewport.zoom;

    return actions.filter((action) => {
      const [x, y] = action.position;

      // Add some padding for nodes that are partially visible
      const padding = 200;

      return (
        x >= visibleX - padding &&
        x <= visibleX + visibleWidth + padding &&
        y >= visibleY - padding &&
        y <= visibleY + visibleHeight + padding
      );
    });
  }, [actions, viewport, canvasWidth, canvasHeight]);
}

// ============================================================================
// Performance Monitoring
// ============================================================================

export class PerformanceMonitor {
  private measurements: Map<string, number[]> = new Map();
  private maxSamples = 100;

  /**
   * Start measuring an operation
   */
  start(label: string): () => void {
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;

      this.recordMeasurement(label, duration);
    };
  }

  /**
   * Record a measurement
   */
  private recordMeasurement(label: string, duration: number): void {
    if (!this.measurements.has(label)) {
      this.measurements.set(label, []);
    }

    const samples = this.measurements.get(label)!;
    samples.push(duration);

    // Limit samples
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
  }

  /**
   * Get statistics for a label
   */
  getStats(label: string): {
    count: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const samples = this.measurements.get(label);
    if (!samples || samples.length === 0) {
      return null;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      avg: sum / count,
      min: sorted[0] ?? 0,
      max: sorted[count - 1] ?? 0,
      p50: sorted[Math.floor(count * 0.5)] ?? 0,
      p95: sorted[Math.floor(count * 0.95)] ?? 0,
      p99: sorted[Math.floor(count * 0.99)] ?? 0,
    };
  }

  /**
   * Get all measurements
   */
  getAllStats(): Record<string, ReturnType<PerformanceMonitor["getStats"]>> {
    const stats: Record<
      string,
      ReturnType<PerformanceMonitor["getStats"]>
    > = {};

    for (const label of this.measurements.keys()) {
      stats[label] = this.getStats(label);
    }

    return stats;
  }

  /**
   * Clear measurements
   */
  clear(): void {
    this.measurements.clear();
  }

  /**
   * Log stats to console
   */
  logStats(label?: string): void {
    if (label) {
      const stats = this.getStats(label);
      if (stats) {
        log.debug(`Performance [${label}]:`, stats);
      }
    } else {
      const allStats = this.getAllStats();
      // eslint-disable-next-line no-console -- table output for manual diagnostics
      console.table(allStats);
    }
  }
}

/**
 * Hook for performance monitoring
 */
export function usePerformanceMonitor(): PerformanceMonitor {
  const monitorRef = useRef<PerformanceMonitor | undefined>(undefined);

  if (!monitorRef.current) {
    monitorRef.current = new PerformanceMonitor();
  }

  return monitorRef.current;
}

/**
 * Hook to measure render performance
 */
export function useRenderPerformance(label: string): void {
  const monitor = usePerformanceMonitor();

  useEffect(() => {
    const end = monitor.start(`render-${label}`);
    return end;
  });
}

// ============================================================================
// Batch Updates
// ============================================================================

export class BatchUpdater<T> {
  private batch: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private callback: (batch: T[]) => void;
  private batchSize: number;
  private delay: number;

  constructor(callback: (batch: T[]) => void, batchSize = 10, delay = 100) {
    this.callback = callback;
    this.batchSize = batchSize;
    this.delay = delay;
  }

  /**
   * Add item to batch
   */
  add(item: T): void {
    this.batch.push(item);

    if (this.batch.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Schedule batch flush
   */
  private scheduleFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.delay);
  }

  /**
   * Flush batch immediately
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.batch.length > 0) {
      this.callback([...this.batch]);
      this.batch = [];
    }
  }

  /**
   * Clear batch without flushing
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.batch = [];
  }
}

/**
 * Hook for batch updates
 */
export function useBatchUpdater<T>(
  callback: (batch: T[]) => void,
  batchSize = 10,
  delay = 100
): BatchUpdater<T> {
  const updaterRef = useRef<BatchUpdater<T> | undefined>(undefined);

  if (!updaterRef.current) {
    updaterRef.current = new BatchUpdater(callback, batchSize, delay);
  }

  useEffect(() => {
    return () => {
      updaterRef.current?.flush();
    };
  }, []);

  return updaterRef.current;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Calculate bounding box for actions
 */
export function calculateBoundingBox(actions: Action[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (actions.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const action of actions) {
    const [x, y] = action.position;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate optimal viewport to fit all actions
 */
export function calculateFitViewport(
  actions: Action[],
  canvasWidth: number,
  canvasHeight: number,
  padding = 50
): { x: number; y: number; zoom: number } {
  if (actions.length === 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  const bbox = calculateBoundingBox(actions);

  const contentWidth = bbox.width + padding * 2;
  const contentHeight = bbox.height + padding * 2;

  const zoomX = canvasWidth / contentWidth;
  const zoomY = canvasHeight / contentHeight;
  const zoom = Math.min(zoomX, zoomY, 2); // Max zoom of 2x

  const x = -(bbox.minX - padding) * zoom;
  const y = -(bbox.minY - padding) * zoom;

  return { x, y, zoom };
}
