"use client";

/**
 * TEMPORARY DEBUG COMPONENT - Remove after diagnosing memory leak.
 *
 * Displays JS heap size on-screen (avoids console.log to not contribute to the leak).
 * Uses performance.memory (Chrome-only API).
 */

import { useEffect, useRef, useState } from "react";

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface MemorySample {
  timestamp: number;
  usedMB: number;
  totalMB: number;
}

export function MemoryMonitor() {
  const [visible, setVisible] = useState(true);
  const [samples, setSamples] = useState<MemorySample[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const perf = performance as Performance & { memory?: MemoryInfo };
    if (!perf.memory) return;

    const sample = () => {
      const mem = perf.memory!;
      const entry: MemorySample = {
        timestamp: Date.now(),
        usedMB: Math.round(mem.usedJSHeapSize / 1048576),
        totalMB: Math.round(mem.totalJSHeapSize / 1048576),
      };
      setSamples((prev) => [...prev, entry].slice(-60)); // Keep last 2 minutes at 2s interval
    };

    sample();
    intervalRef.current = setInterval(sample, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!visible || samples.length === 0) return null;

  const latest = samples[samples.length - 1]!;
  const oldest = samples[0]!;
  const growthMB = latest.usedMB - oldest.usedMB;
  const elapsedSec = Math.max(1, (latest.timestamp - oldest.timestamp) / 1000);
  const growthPerMin = Math.round((growthMB / elapsedSec) * 60);

  const isLeaking = growthPerMin > 50; // More than 50 MB/min is suspicious

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 99999,
        background: isLeaking ? "#dc2626" : "#1e293b",
        color: "white",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 12,
        fontFamily: "monospace",
        opacity: 0.9,
        cursor: "pointer",
        maxWidth: 280,
      }}
      onClick={() => setVisible(false)}
      title="Click to dismiss. TEMPORARY - remove after debugging."
    >
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>
        JS Heap: {latest.usedMB} MB / {latest.totalMB} MB
      </div>
      <div>
        Growth: {growthMB > 0 ? "+" : ""}
        {growthMB} MB in {Math.round(elapsedSec)}s (~{growthPerMin} MB/min)
      </div>
      {isLeaking && (
        <div style={{ color: "#fca5a5", marginTop: 4 }}>
          LEAK DETECTED - heap growing rapidly
        </div>
      )}
      <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 10 }}>
        {samples.length} samples | Click to dismiss
      </div>
    </div>
  );
}
