"use client";

/**
 * Grounding Capture Host — outer page that keeps the UI Bridge SDK stable
 * while cycling an inner iframe through isolated-component variants.
 *
 * Why:
 *   The standalone isolated-component page (/dev/grounding/isolated) renders
 *   a position:fixed backdrop that has been observed to destabilise the UI
 *   Bridge provider tree on some Next.js 15 builds — heartbeats stop and
 *   navigation commands can't be delivered.  Hosting the isolated content in
 *   an iframe isolates the risk: the outer page is a normal App-Router page
 *   with the full provider stack, so the SDK stays connected for the entire
 *   capture run.
 *
 * How:
 *   - The capture script writes JSON `{"url": "/api/grounding-isolated?..."}`
 *     into a UI Bridge-registered `<input>` via setValue, then clicks a
 *     `<button>` to advance the iframe.
 *   - After each navigation, the inner iframe posts a message back with the
 *     target element's bbox (viewport-relative); we render it into a
 *     `data-current-bbox` attribute on `<body>` so `/control/snapshot` can
 *     return it along with the iframe element.
 *   - The capture script takes its `mss` screenshot once it sees a fresh
 *     `data-current-sample-index`.
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

export default function CaptureHostPage() {
  const [pendingUrl, setPendingUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState(
    "/api/grounding-isolated?component=Button&variant=default&bg=solid-white&left=50&top=50",
  );
  const [sampleIndex, setSampleIndex] = useState(-1);
  const [lastBbox, setLastBbox] = useState<IframeBbox | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Register the URL input + advance button with UI Bridge so the capture
  // script can drive the iframe via setValue/click commands.
  const inputRegistered = useUIElement({
    id: "capture-next-url",
    description: "Pending isolated-sample URL the host iframe will load next",
    type: "input",
  });
  const advanceBtnRegistered = useUIElement({
    id: "capture-advance",
    description:
      "Click to load the pending URL into the host iframe and move to the next sample",
    type: "button",
  });
  // Void the return values; the hooks just side-effect register the elements.
  void inputRegistered;
  void advanceBtnRegistered;

  // Receive bbox messages from the iframe and surface them via body attrs
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (
        typeof data !== "object" ||
        data === null ||
        data.kind !== "grounding-bbox"
      ) {
        return;
      }
      const bbox: IframeBbox = {
        x: Number(data.x ?? 0),
        y: Number(data.y ?? 0),
        width: Number(data.width ?? 0),
        height: Number(data.height ?? 0),
        sampleIndex: Number(data.sampleIndex ?? -1),
        component: data.component,
        variant: data.variant,
      };
      setLastBbox(bbox);
      // Surface for snapshot-based extraction
      document.body.setAttribute(
        "data-current-bbox",
        JSON.stringify(bbox),
      );
      document.body.setAttribute(
        "data-current-sample-index",
        String(bbox.sampleIndex),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const advance = useCallback(() => {
    if (!pendingUrl) return;
    const next = pendingUrl;
    setPendingUrl("");
    setSampleIndex((i) => i + 1);
    setCurrentUrl(next);
  }, [pendingUrl]);

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
          type="text"
          value={pendingUrl}
          onChange={(e) => setPendingUrl(e.target.value)}
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
        sample #{sampleIndex} — bbox: {lastBbox ? `${lastBbox.x},${lastBbox.y} ${lastBbox.width}×${lastBbox.height}` : "(none)"}
      </div>
      <iframe
        ref={iframeRef}
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
