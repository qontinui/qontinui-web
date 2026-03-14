/**
 * Memory Growth Detector
 *
 * Monitors JS heap size over time and detects monotonic growth patterns
 * that indicate memory leaks. Also tracks DOM node count, Zustand store
 * sizes, and event listener counts.
 *
 * Designed to run in production — lightweight enough to always be on.
 * Persists snapshots so data survives even if the page eventually freezes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemorySnapshot {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  domNodeCount: number;
  storeSizes: Record<string, number>;
  listenerEstimate: number;
}

export interface GrowthAnalysis {
  /** Current heap in MB */
  currentMB: number;
  /** Heap limit in MB */
  limitMB: number;
  /** Estimated growth rate in MB per minute */
  growthRateMBPerMin: number;
  /** Fraction of samples showing growth (0-1) */
  growthFraction: number;
  /** Whether a leak is likely */
  leakDetected: boolean;
  /** Severity: 'ok' | 'warning' | 'critical' */
  severity: "ok" | "warning" | "critical";
  /** Human-readable summary */
  summary: string;
  /** Number of snapshots in the window */
  sampleCount: number;
  /** Estimated time until heap limit in minutes (Infinity if not growing) */
  estimatedTimeToOOM: number;
  /** Largest stores by estimated size */
  topStores: { name: string; estimatedSizeKB: number }[];
}

export type GrowthCallback = (analysis: GrowthAnalysis) => void;

interface StoreProbe {
  name: string;
  getState: () => unknown;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SAMPLE_INTERVAL_MS = 30_000; // 30 seconds (was 10s — caused GC pressure)
const WINDOW_DURATION_MS = 5 * 60_000; // 5 minute rolling window
const MIN_SAMPLES_FOR_ANALYSIS = 6; // Need ≥1 minute of data
const GROWTH_FRACTION_WARN = 0.7; // 70% of samples growing → warning
const GROWTH_FRACTION_CRIT = 0.85; // 85% → critical
const GROWTH_RATE_WARN_MB_MIN = 20; // >20 MB/min → warning
const GROWTH_RATE_CRIT_MB_MIN = 100; // >100 MB/min → critical
const HEAP_WARN_MB = 2048; // >2 GB absolute → warning
const HEAP_CRIT_MB = 4096; // >4 GB → critical

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getMemory(): PerformanceMemory | null {
  const perf = performance as Performance & { memory?: PerformanceMemory };
  return perf.memory ?? null;
}

function countDOMNodes(): number {
  // getElementsByTagName returns a live HTMLCollection — no array allocation
  return document.getElementsByTagName("*").length;
}

/**
 * Estimate the size of a Zustand store state cheaply.
 *
 * IMPORTANT: Does NOT use JSON.stringify — repeated stringify calls every
 * sample interval create temporary string garbage that causes GC pressure
 * and escalating freezes. Instead, we walk one level deep and use
 * structural heuristics (key counts, array lengths, string lengths).
 */
function estimateObjectSizeKB(obj: unknown): number {
  if (obj == null) return 0;
  if (typeof obj !== "object") {
    return typeof obj === "string" ? (obj as string).length / 1024 : 0.008;
  }

  let totalBytes = 0;

  try {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value == null || typeof value === "function") continue;

      if (Array.isArray(value)) {
        // Estimate: 100 bytes per element (rough average for typical state objects)
        totalBytes += value.length * 100;
      } else if (value instanceof Map) {
        totalBytes += value.size * 200;
      } else if (value instanceof Set) {
        totalBytes += value.size * 50;
      } else if (typeof value === "object") {
        // Count keys as a size proxy — no stringify
        const keyCount = Object.keys(value as Record<string, unknown>).length;
        totalBytes += keyCount * 200;
      } else if (typeof value === "string") {
        totalBytes += (value as string).length;
      } else {
        totalBytes += 8;
      }
    }
  } catch {
    return 0;
  }

  return totalBytes / 1024;
}

// ---------------------------------------------------------------------------
// Detector class
// ---------------------------------------------------------------------------

export class MemoryGrowthDetector {
  private snapshots: MemorySnapshot[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private stores: StoreProbe[] = [];
  private listeners: Set<GrowthCallback> = new Set();
  private lastAnalysis: GrowthAnalysis | null = null;
  private persistEndpoint: string | null = null;
  private persistBuffer: MemorySnapshot[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: { persistEndpoint?: string | undefined }) {
    this.persistEndpoint = options?.persistEndpoint ?? null;
  }

  // -------------------------------------------------------------------------
  // Store registration
  // -------------------------------------------------------------------------

  /**
   * Register a Zustand store to track its size over time.
   * Call this once per store at app startup.
   */
  registerStore(name: string, getState: () => unknown): void {
    // Avoid duplicates
    if (!this.stores.some((s) => s.name === name)) {
      this.stores.push({ name, getState });
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.intervalId) return;
    if (!getMemory()) {
      console.warn(
        "[MemoryGrowthDetector] performance.memory not available — detector disabled"
      );
      return;
    }

    // Take initial snapshot immediately
    this.takeSample();

    this.intervalId = setInterval(() => {
      this.takeSample();
    }, SAMPLE_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.flushPersist();
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  // -------------------------------------------------------------------------
  // Subscription
  // -------------------------------------------------------------------------

  subscribe(callback: GrowthCallback): () => void {
    this.listeners.add(callback);
    // Immediately fire with last analysis if available
    if (this.lastAnalysis) {
      callback(this.lastAnalysis);
    }
    return () => {
      this.listeners.delete(callback);
    };
  }

  getLastAnalysis(): GrowthAnalysis | null {
    return this.lastAnalysis;
  }

  getSnapshots(): readonly MemorySnapshot[] {
    return this.snapshots;
  }

  // -------------------------------------------------------------------------
  // Sampling
  // -------------------------------------------------------------------------

  private takeSample(): void {
    const mem = getMemory();
    if (!mem) return;

    // Measure store sizes
    const storeSizes: Record<string, number> = {};
    for (const store of this.stores) {
      try {
        storeSizes[store.name] = estimateObjectSizeKB(store.getState());
      } catch {
        storeSizes[store.name] = -1;
      }
    }

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsedMB: Math.round((mem.usedJSHeapSize / 1024 / 1024) * 10) / 10,
      heapTotalMB: Math.round((mem.totalJSHeapSize / 1024 / 1024) * 10) / 10,
      heapLimitMB: Math.round((mem.jsHeapSizeLimit / 1024 / 1024) * 10) / 10,
      domNodeCount: countDOMNodes(),
      storeSizes,
      listenerEstimate: this.estimateListenerCount(),
    };

    this.snapshots.push(snapshot);

    // Trim to rolling window
    const cutoff = Date.now() - WINDOW_DURATION_MS;
    while (this.snapshots.length > 0 && this.snapshots[0]!.timestamp < cutoff) {
      this.snapshots.shift();
    }

    // Analyze and notify
    const analysis = this.analyze();
    this.lastAnalysis = analysis;
    for (const cb of this.listeners) {
      try {
        cb(analysis);
      } catch {
        // Don't let subscriber errors break the detector
      }
    }

    // Persist
    if (this.persistEndpoint) {
      this.persistBuffer.push(snapshot);
      if (!this.persistTimer) {
        this.persistTimer = setTimeout(() => this.flushPersist(), 30_000);
      }
    }
  }

  private estimateListenerCount(): number {
    // Rough heuristic: count elements with common event-bearing attributes
    // This is cheap and gives a trend signal, not an exact count
    try {
      const interactive = document.querySelectorAll(
        "button, a, input, select, textarea, [onclick], [onchange], [onkeydown]"
      );
      return interactive.length;
    } catch {
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Analysis
  // -------------------------------------------------------------------------

  private analyze(): GrowthAnalysis {
    const n = this.snapshots.length;
    const latest = this.snapshots[n - 1];

    if (!latest || n < 2) {
      return {
        currentMB: latest?.heapUsedMB ?? 0,
        limitMB: latest?.heapLimitMB ?? 0,
        growthRateMBPerMin: 0,
        growthFraction: 0,
        leakDetected: false,
        severity: "ok",
        summary: "Collecting samples...",
        sampleCount: n,
        estimatedTimeToOOM: Infinity,
        topStores: [],
      };
    }

    // Count how many consecutive pairs show growth
    let growingPairs = 0;
    for (let i = 1; i < n; i++) {
      if (this.snapshots[i]!.heapUsedMB > this.snapshots[i - 1]!.heapUsedMB) {
        growingPairs++;
      }
    }
    const growthFraction = growingPairs / (n - 1);

    // Calculate growth rate via linear regression
    const first = this.snapshots[0]!;
    const elapsedMin = (latest.timestamp - first.timestamp) / 60_000;
    const growthMB = latest.heapUsedMB - first.heapUsedMB;
    const growthRateMBPerMin =
      elapsedMin > 0 ? Math.round((growthMB / elapsedMin) * 10) / 10 : 0;

    // Estimated time to OOM
    const headroomMB = latest.heapLimitMB - latest.heapUsedMB;
    const estimatedTimeToOOM =
      growthRateMBPerMin > 0
        ? Math.round(headroomMB / growthRateMBPerMin)
        : Infinity;

    // Determine severity
    let severity: "ok" | "warning" | "critical" = "ok";
    let leakDetected = false;

    if (n >= MIN_SAMPLES_FOR_ANALYSIS) {
      if (
        latest.heapUsedMB >= HEAP_CRIT_MB ||
        (growthFraction >= GROWTH_FRACTION_CRIT &&
          growthRateMBPerMin >= GROWTH_RATE_WARN_MB_MIN) ||
        growthRateMBPerMin >= GROWTH_RATE_CRIT_MB_MIN
      ) {
        severity = "critical";
        leakDetected = true;
      } else if (
        latest.heapUsedMB >= HEAP_WARN_MB ||
        (growthFraction >= GROWTH_FRACTION_WARN &&
          growthRateMBPerMin >= GROWTH_RATE_WARN_MB_MIN)
      ) {
        severity = "warning";
        leakDetected = true;
      }
    }

    // Top stores by size
    const topStores = Object.entries(latest.storeSizes)
      .map(([name, kb]) => ({ name, estimatedSizeKB: Math.round(kb) }))
      .filter((s) => s.estimatedSizeKB > 0)
      .sort((a, b) => b.estimatedSizeKB - a.estimatedSizeKB)
      .slice(0, 5);

    // Build summary
    let summary: string;
    if (severity === "critical") {
      summary = `LEAK: ${latest.heapUsedMB.toFixed(0)} MB heap, growing ${growthRateMBPerMin > 0 ? "+" : ""}${growthRateMBPerMin} MB/min`;
      if (estimatedTimeToOOM < 60) {
        summary += ` — OOM in ~${estimatedTimeToOOM} min`;
      }
    } else if (severity === "warning") {
      summary = `Warning: ${latest.heapUsedMB.toFixed(0)} MB heap, +${growthRateMBPerMin} MB/min`;
    } else {
      summary = `${latest.heapUsedMB.toFixed(0)} MB heap, ${growthRateMBPerMin >= 0 ? "+" : ""}${growthRateMBPerMin} MB/min`;
    }

    return {
      currentMB: latest.heapUsedMB,
      limitMB: latest.heapLimitMB,
      growthRateMBPerMin,
      growthFraction: Math.round(growthFraction * 100) / 100,
      leakDetected,
      severity,
      summary,
      sampleCount: n,
      estimatedTimeToOOM,
      topStores,
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private flushPersist(): void {
    this.persistTimer = null;
    if (!this.persistEndpoint || this.persistBuffer.length === 0) return;

    const batch = this.persistBuffer;
    this.persistBuffer = [];

    const events = batch.map((snap) => ({
      ...snap,
      type: "memory-growth" as const,
      url: typeof window !== "undefined" ? window.location.href : "",
    }));

    const body = JSON.stringify({ events });

    // Use sendBeacon for reliability (won't block, survives page freeze)
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        this.persistEndpoint,
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(this.persistEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: MemoryGrowthDetector | null = null;

export function getMemoryGrowthDetector(): MemoryGrowthDetector {
  if (!instance) {
    instance = new MemoryGrowthDetector({
      persistEndpoint:
        process.env.NODE_ENV === "development"
          ? "/api/dev-debug/perf-events"
          : undefined,
    });
  }
  return instance;
}
