"use client";

/**
 * Memory Growth Overlay
 *
 * Always-on in-page overlay that shows heap usage and growth trends.
 * Designed for diagnosing memory leaks when DevTools is unavailable
 * (e.g., page is too frozen to open F12).
 *
 * - Small badge in bottom-left: current heap + growth rate
 * - Click to expand: detailed breakdown with stores, DOM nodes, timeline
 * - Color-coded: green (ok), yellow (warning), red (critical)
 * - Persists data to backend so it survives page freezes
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getMemoryGrowthDetector,
  type GrowthAnalysis,
  type MemorySnapshot,
} from "@/lib/memory-growth-detector";

// Import stores to register them with the detector
import { useCanvasStore } from "@/stores/canvas-store";
import { useExecutionStore } from "@/stores/execution-store";
import { useExecutionDebugger } from "@/stores/execution-debugger-store";
import { useConversionHistoryStore } from "@/stores/conversion-history";

export function MemoryGrowthOverlay() {
  const [analysis, setAnalysis] = useState<GrowthAnalysis | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [snapshots, setSnapshots] = useState<readonly MemorySnapshot[]>([]);
  const registeredRef = useRef(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const detector = getMemoryGrowthDetector();

    // Register stores once
    if (!registeredRef.current) {
      registeredRef.current = true;
      detector.registerStore("canvas", useCanvasStore.getState);
      detector.registerStore("execution", useExecutionStore.getState);
      detector.registerStore("debugger", useExecutionDebugger.getState);
      detector.registerStore("convHistory", useConversionHistoryStore.getState);
    }

    // Subscribe to analysis updates — use ref to avoid re-subscribing on expand toggle
    const unsubscribe = detector.subscribe((a) => {
      setAnalysis(a);
      if (expandedRef.current) {
        setSnapshots([...detector.getSnapshots()]);
      }
    });

    // Start if not already running
    if (!detector.isRunning()) {
      detector.start();
    }

    return unsubscribe;
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      if (!prev) {
        setSnapshots([...getMemoryGrowthDetector().getSnapshots()]);
      }
      return !prev;
    });
  }, []);

  if (!analysis) return null;

  const { severity, currentMB, growthRateMBPerMin, summary } = analysis;

  // Badge colors
  const badgeColor =
    severity === "critical"
      ? "bg-red-600 text-white"
      : severity === "warning"
        ? "bg-yellow-500 text-black"
        : "bg-zinc-800 text-zinc-300";

  const borderColor =
    severity === "critical"
      ? "border-red-600"
      : severity === "warning"
        ? "border-yellow-500"
        : "border-zinc-700";

  return (
    <div
      style={{ zIndex: 99999 }}
      className="fixed bottom-2 left-2 select-none font-mono text-xs"
    >
      {/* Badge */}
      <button
        onClick={toggleExpanded}
        className={`${badgeColor} rounded px-2 py-1 shadow-lg border ${borderColor} hover:opacity-90 transition-opacity cursor-pointer`}
      >
        <span className="font-bold">{Math.round(currentMB)}</span>
        <span className="opacity-70"> MB</span>
        {analysis.sampleCount >= 6 && (
          <>
            <span className="mx-1 opacity-40">|</span>
            <span
              className={
                growthRateMBPerMin > 20
                  ? "text-red-300"
                  : growthRateMBPerMin > 5
                    ? "text-yellow-300"
                    : "opacity-70"
              }
            >
              {growthRateMBPerMin >= 0 ? "+" : ""}
              {growthRateMBPerMin}
            </span>
            <span className="opacity-50"> MB/m</span>
          </>
        )}
        {severity !== "ok" && (
          <span className="ml-1 animate-pulse">
            {severity === "critical" ? " !!!" : " !"}
          </span>
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div
          className={`mt-1 rounded-lg border ${borderColor} bg-zinc-900 text-zinc-200 shadow-2xl p-3 w-80 max-h-96 overflow-y-auto`}
        >
          {/* Summary */}
          <div
            className={`mb-2 font-bold ${severity === "critical" ? "text-red-400" : severity === "warning" ? "text-yellow-400" : "text-zinc-300"}`}
          >
            {summary}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-[11px]">
            <div className="text-zinc-500">Heap used</div>
            <div>{currentMB.toFixed(1)} MB</div>
            <div className="text-zinc-500">Heap limit</div>
            <div>{analysis.limitMB.toFixed(0)} MB</div>
            <div className="text-zinc-500">Growth rate</div>
            <div>
              {growthRateMBPerMin >= 0 ? "+" : ""}
              {growthRateMBPerMin} MB/min
            </div>
            <div className="text-zinc-500">Growth fraction</div>
            <div>{Math.round(analysis.growthFraction * 100)}% of samples</div>
            <div className="text-zinc-500">Samples</div>
            <div>{analysis.sampleCount} (last 5 min)</div>
            <div className="text-zinc-500">Est. time to OOM</div>
            <div>
              {analysis.estimatedTimeToOOM === Infinity
                ? "—"
                : `~${analysis.estimatedTimeToOOM} min`}
            </div>
            <div className="text-zinc-500">DOM nodes</div>
            <div>
              {snapshots.length > 0
                ? snapshots[snapshots.length - 1]!.domNodeCount.toLocaleString()
                : "—"}
            </div>
            <div className="text-zinc-500">Interactive els</div>
            <div>
              {snapshots.length > 0
                ? snapshots[
                    snapshots.length - 1
                  ]!.listenerEstimate.toLocaleString()
                : "—"}
            </div>
          </div>

          {/* Store sizes */}
          {analysis.topStores.length > 0 && (
            <div className="mb-3">
              <div className="text-zinc-500 mb-1 text-[11px] font-bold uppercase tracking-wider">
                Store sizes (est.)
              </div>
              {analysis.topStores.map((s) => (
                <div key={s.name} className="flex justify-between text-[11px]">
                  <span className="text-zinc-400">{s.name}</span>
                  <span>
                    {s.estimatedSizeKB > 1024
                      ? `${(s.estimatedSizeKB / 1024).toFixed(1)} MB`
                      : `${s.estimatedSizeKB} KB`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Mini timeline (ASCII sparkline) */}
          {snapshots.length > 1 && (
            <div className="mb-2">
              <div className="text-zinc-500 mb-1 text-[11px] font-bold uppercase tracking-wider">
                Heap timeline
              </div>
              <Sparkline snapshots={snapshots} />
            </div>
          )}

          {/* DOM node timeline */}
          {snapshots.length > 1 && (
            <div>
              <div className="text-zinc-500 mb-1 text-[11px] font-bold uppercase tracking-wider">
                DOM nodes
              </div>
              <DOMSparkline snapshots={snapshots} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline components
// ---------------------------------------------------------------------------

function Sparkline({ snapshots }: { snapshots: readonly MemorySnapshot[] }) {
  const values = snapshots.map((s) => s.heapUsedMB);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Show at most 30 bars
  const step = Math.max(1, Math.floor(values.length / 30));
  const sampled = values.filter((_, i) => i % step === 0);

  const HEIGHT = 32;

  return (
    <div className="flex items-end gap-px" style={{ height: HEIGHT }}>
      {sampled.map((v, i) => {
        const h = Math.max(2, ((v - min) / range) * HEIGHT);
        const pct = (v - min) / range;
        const color =
          pct > 0.8
            ? "bg-red-500"
            : pct > 0.5
              ? "bg-yellow-500"
              : "bg-emerald-500";
        return (
          <div
            key={i}
            className={`${color} rounded-t-sm opacity-80`}
            style={{ height: h, width: `${100 / sampled.length}%` }}
            title={`${v.toFixed(0)} MB`}
          />
        );
      })}
    </div>
  );
}

function DOMSparkline({
  snapshots,
}: {
  snapshots: readonly MemorySnapshot[];
}) {
  const values = snapshots.map((s) => s.domNodeCount);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const step = Math.max(1, Math.floor(values.length / 30));
  const sampled = values.filter((_, i) => i % step === 0);

  const HEIGHT = 24;

  return (
    <div className="flex items-end gap-px" style={{ height: HEIGHT }}>
      {sampled.map((v, i) => {
        const h = Math.max(2, ((v - min) / range) * HEIGHT);
        return (
          <div
            key={i}
            className="bg-blue-500 rounded-t-sm opacity-60"
            style={{ height: h, width: `${100 / sampled.length}%` }}
            title={`${v.toLocaleString()} nodes`}
          />
        );
      })}
    </div>
  );
}
