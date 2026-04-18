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
 *
 * Two bbox signal channels are supported (see the iframe route for how they
 * are populated):
 *   - Channel A: window.postMessage({kind: "grounding-bbox", ...}).
 *     Works when the host tab is focused.  Mirrored into the
 *     `capture-last-bbox` / `capture-last-echo` inputs for automation via
 *     /control/snapshot.
 *   - Channel B: fetch('/api/grounding-isolated/bbox').  Tab-focus-
 *     independent. Polled directly by the capture driver.
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
  useUIElement({
    id: "capture-real-extract",
    label:
      "Extract real-page elements + html2canvas screenshot from iframe — used for real-world eval",
    type: "button",
  });

  // Load html2canvas on the host (not just inside the isolated iframe) so
  // captureReal() can render the iframe's same-origin DOM into a canvas.
  useEffect(() => {
    const w = window as { html2canvas?: unknown };
    if (w.html2canvas) return;
    const s = document.createElement("script");
    s.src = "/html2canvas.min.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // Self-drive mode: the page can be opened with ?real=/a,/b&interval=8000
  // and it will cycle the iframe through each route, auto-capturing on load.
  // This avoids having to drive the page via UI Bridge element actions —
  // useful when multiple tabs are competing and command routing is flaky.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const real = params.get("real");
    if (!real) return;
    const interval = Math.max(
      1500,
      parseInt(params.get("interval") ?? "8000", 10)
    );
    const routes = real
      .split(",")
      .map((r) => decodeURIComponent(r))
      .filter(Boolean);
    let idx = 0;
    let cancelled = false;

    function step() {
      if (cancelled || idx >= routes.length) return;
      const route = routes[idx];
      idx += 1;
      setSampleIndex(idx - 1);
      setCurrentUrl(new URL(route!, window.location.origin).toString());
      setTimeout(step, interval);
    }
    // Give html2canvas a chance to load before the first step
    setTimeout(step, 1500);
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Real-page capture: walk the iframe's DOM (same-origin) for interactive
  // elements, html2canvas the body, POST to /api/grounding-isolated/page-capture.
  // Used by capture_grounding_real.py to build a real-world eval set — pure
  // product UI, not synthetic isolated samples.
  const captureReal = useCallback(async () => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-grounding-iframe='true']"
    );
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return; // cross-origin — shouldn't happen on same-origin app

    type RealEl = {
      tag: string;
      role: string;
      text: string;
      bbox: [number, number, number, number];
    };
    const out: RealEl[] = [];
    const selectors = [
      "button",
      "input:not([type='hidden'])",
      "textarea",
      "a[href]",
      "[role='switch']",
      "[role='checkbox']",
      "[role='tab']",
      "[role='slider']",
      "[role='radio']",
      "[role='combobox']",
      "[role='menuitem']",
    ];
    const seen = new Set<Element>();
    for (const sel of selectors) {
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        if (seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) continue;
        if (r.x < 0 || r.y < 0) continue;
        if (r.right > doc.documentElement.clientWidth) continue;
        if (r.bottom > doc.documentElement.clientHeight) continue;
        const text =
          (el as HTMLElement).innerText ||
          (el as HTMLInputElement).value ||
          (el as HTMLInputElement).placeholder ||
          el.getAttribute("aria-label") ||
          "";
        out.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || el.tagName.toLowerCase(),
          text: text.trim().slice(0, 80),
          bbox: [
            Math.round(r.x),
            Math.round(r.y),
            Math.round(r.width),
            Math.round(r.height),
          ],
        });
      }
    }

    const h2c = (
      window as {
        html2canvas?: (
          el: HTMLElement,
          opts?: Record<string, unknown>
        ) => Promise<HTMLCanvasElement>;
      }
    ).html2canvas;
    if (!h2c) return;
    const canvas = await h2c(doc.body, {
      backgroundColor: null,
      logging: false,
      width: doc.documentElement.clientWidth,
      height: doc.documentElement.clientHeight,
      windowWidth: doc.documentElement.clientWidth,
      windowHeight: doc.documentElement.clientHeight,
    });
    await fetch("/api/grounding-isolated/page-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: iframe.src,
        key: iframe.src,
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        elements: out,
      }),
      keepalive: true,
    });
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
        <button
          id="capture-real-extract"
          type="button"
          onClick={captureReal}
          style={{
            padding: "4px 12px",
            background: "#10b981",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Real Capture
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
        onLoad={() => {
          // Only auto-capture for "real" pages (qontinui-web routes), not
          // the synthetic /api/grounding-isolated iframes (which self-report).
          // Heuristic: if the current URL doesn't include
          // '/api/grounding-isolated', treat it as a real-page capture.
          if (!currentUrl.includes("/api/grounding-isolated")) {
            // give html2canvas a beat to be loaded and the page to settle
            setTimeout(() => {
              captureReal().catch(() => {
                /* ignore — driver will observe timeout */
              });
            }, 500);
          }
        }}
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
