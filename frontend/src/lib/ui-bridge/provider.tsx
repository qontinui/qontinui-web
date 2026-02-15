"use client";

/**
 * UI Bridge Provider Wrapper
 *
 * Configures UIBridgeProvider with appropriate features based on environment.
 * Includes AutoRegisterProvider for automatic element registration.
 * Supports both WebSocket and HTTP polling for remote automation.
 *
 * In development, captured browser events are batched and persisted
 * to .dev-logs/browser-events.jsonl via a Next.js API route.
 *
 * Transport modes:
 * - 'auto' (default): Try WebSocket first, fall back to HTTP polling
 * - 'websocket': Use WebSocket only
 * - 'http': Use HTTP polling only
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  UIBridgeProvider,
  AutoRegisterProvider,
} from "@qontinui/ui-bridge/react";
import type {
  UIBridgeFeatures,
  UIBridgeConfig,
} from "@qontinui/ui-bridge/core";
import type { AnyCapturedEvent } from "@qontinui/ui-bridge/debug";
import { UIBridgeTransportListener } from "./UIBridgeTransportListener";
import type { TransportMode } from "./useUIBridgeTransport";

const isDev = process.env.NODE_ENV === "development";

/**
 * Feature configuration for UI Bridge
 * Render logging is always enabled for state discovery.
 */
const features: UIBridgeFeatures = {
  renderLog: true,
  control: true,
  debug: isDev,
};

/**
 * Configuration for UI Bridge
 */
const config: UIBridgeConfig = {
  verbose: isDev,
  maxLogEntries: 10, // Reduced from 1000 - each entry is a full DOM snapshot (several MB)
};

const FLUSH_INTERVAL_MS = 500;
const EVENTS_ENDPOINT = "/api/dev-debug/browser-events";

interface UIBridgeWrapperProps {
  children: React.ReactNode;
  /**
   * Enable remote command listening for automation.
   * Defaults to true in development.
   */
  enableRemoteCommands?: boolean;
  /**
   * Transport mode for remote commands.
   * - 'auto' (default): Try WebSocket first, fall back to HTTP polling
   * - 'websocket': Use WebSocket only
   * - 'http': Use HTTP polling only
   */
  transport?: TransportMode;
  /**
   * WebSocket URL for remote commands.
   * Defaults to current host with /api/ui-bridge/ws path.
   */
  wsUrl?: string;
}

/**
 * UI Bridge Provider wrapper component.
 *
 * This wraps the application with UIBridgeProvider for state discovery.
 * Render logging is always enabled.
 *
 * Features:
 * - Automatic element registration via AutoRegisterProvider
 * - Remote command listening via WebSocket (primary) or HTTP polling (fallback)
 * - SWC plugin integration for compile-time instrumentation
 * - Browser event persistence to .dev-logs (dev only)
 */
export function UIBridgeWrapper({
  children,
  enableRemoteCommands = isDev,
  transport = "auto",
  wsUrl,
}: UIBridgeWrapperProps) {
  const bufferRef = useRef<AnyCapturedEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timerRef.current = null;
    const batch = bufferRef.current;
    if (batch.length === 0) return;
    bufferRef.current = [];

    const body = JSON.stringify({ events: batch });

    // Use sendBeacon if available (more reliable during unload), else fetch
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(EVENTS_ENDPOINT, new Blob([body], { type: "application/json" }));
    } else {
      fetch(EVENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  const onBrowserEvent = useCallback(
    (event: AnyCapturedEvent) => {
      bufferRef.current.push(event);
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
    },
    [flush]
  );

  // Clear the JSONL file on mount (new session)
  useEffect(() => {
    if (!isDev) return;
    fetch(EVENTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    }).catch(() => {});
  }, []);

  // Flush remaining events on page unload
  useEffect(() => {
    if (!isDev) return;
    const handleUnload = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      // Also flush on unmount
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    };
  }, [flush]);

  return (
    <UIBridgeProvider
      features={features}
      config={config}
      onBrowserEvent={isDev ? onBrowserEvent : undefined}
    >
      {/* AutoRegisterProvider enables automatic element registration for UI Bridge */}
      {/* All interactive elements (buttons, inputs, links, etc.) are auto-discovered */}
      <AutoRegisterProvider
        enabled={true}
        idStrategy="prefer-existing"
        debounceMs={100}
        excludeSelectors={["[data-no-register]"]}
      >
        {/* Transport listener for remote automation (WebSocket primary, HTTP fallback) */}
        <UIBridgeTransportListener
          enabled={enableRemoteCommands}
          mode={transport}
          wsUrl={wsUrl}
        />
        {children as Parameters<typeof AutoRegisterProvider>[0]["children"]}
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
