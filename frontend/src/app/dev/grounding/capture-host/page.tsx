"use client";

/**
 * Grounding Capture Host
 *
 * Inline implementation of the capture-host pattern, coupled to the
 * `/api/grounding-isolated` iframe protocol used by the qontinui-runner
 * capture script.
 *
 * For new apps, prefer the reusable primitives from the UI Bridge SDK:
 *   import { CaptureHostFrame } from '@qontinui/ui-bridge/react';
 *   <CaptureHostFrame messageKind="grounding-bbox" initialSrc={...} />
 *
 * Pattern docs: see `proj_ui_bridge_capture_host_pattern.md` in memory.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";

interface IframeBbox {
  x: number;
  y: number;
  width: number;
  height: number;
  sampleIndex: number;
  component?: string;
  variant?: string;
}

const INITIAL_URL =
  "/api/grounding-isolated?component=Button&variant=default&bg=solid-white&left=50&top=50";

export default function GroundingCaptureHostPage() {
  const [currentUrl, setCurrentUrl] = useState(INITIAL_URL);
  const [sampleIndex, setSampleIndex] = useState(-1);
  const [lastBbox, setLastBbox] = useState<IframeBbox | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  useUIElement({
    id: "capture-next-url",
    label: "Pending isolated-sample URL the host iframe will load next",
    type: "input",
  });
  useUIElement({
    id: "capture-advance",
    label: "Load the pending URL into the host iframe",
    type: "button",
  });
  useUIElement({
    id: "capture-last-bbox",
    label: "JSON echo of the last bbox reported by the iframe",
    type: "input",
  });
  useUIElement({
    id: "capture-last-echo",
    label: "Alias of capture-last-bbox for SDK parity",
    type: "input",
  });

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (
        typeof data !== "object" ||
        data === null ||
        (data as { kind?: unknown }).kind !== "grounding-bbox"
      ) {
        return;
      }
      const d = data as Record<string, unknown>;
      setLastBbox({
        x: Number(d.x ?? 0),
        y: Number(d.y ?? 0),
        width: Number(d.width ?? 0),
        height: Number(d.height ?? 0),
        sampleIndex: Number(d.sampleIndex ?? -1),
        component: d.component as string | undefined,
        variant: d.variant as string | undefined,
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const advance = useCallback(() => {
    const input = urlInputRef.current;
    if (!input) return;
    const next = input.value;
    if (!next) return;
    input.value = "";
    setSampleIndex((i) => i + 1);
    setCurrentUrl(next);
  }, []);

  const bboxJson = lastBbox ? JSON.stringify(lastBbox) : "";

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Grounding Capture Host</h1>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <label htmlFor="capture-next-url" style={{ fontSize: 13 }}>
          Next URL:
        </label>
        <input
          id="capture-next-url"
          ref={urlInputRef}
          type="text"
          defaultValue=""
          placeholder="/api/grounding-isolated?component=Button&..."
          style={{
            flex: 1,
            padding: "4px 8px",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 12,
            fontFamily: "monospace",
          }}
        />
        <button
          id="capture-advance"
          type="button"
          onClick={advance}
          style={{
            padding: "4px 12px",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Advance
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
        sample #{sampleIndex} — bbox:{" "}
        {lastBbox
          ? `${lastBbox.x},${lastBbox.y} ${lastBbox.width}×${lastBbox.height}`
          : "(none)"}
      </div>
      {/* Echo inputs — registered with UI Bridge so automation reads the bbox
          from /control/snapshot. Two IDs for compatibility: legacy
          `capture-last-bbox` and the SDK default `capture-last-echo`. */}
      <input
        id="capture-last-bbox"
        type="text"
        readOnly
        value={bboxJson}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 2,
          height: 2,
          padding: 0,
          border: 0,
          opacity: 0.01,
          pointerEvents: "none",
        }}
      />
      <input
        id="capture-last-echo"
        type="text"
        readOnly
        value={bboxJson}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          left: 2,
          width: 2,
          height: 2,
          padding: 0,
          border: 0,
          opacity: 0.01,
          pointerEvents: "none",
        }}
      />
      <iframe
        key={currentUrl}
        src={currentUrl}
        title="grounding-sample"
        data-grounding-iframe="true"
        style={{
          width: "100%",
          height: "calc(100vh - 140px)",
          border: "1px solid #ddd",
          background: "#fff",
        }}
      />
    </div>
  );
}
