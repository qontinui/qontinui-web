"use client";

/**
 * UI Bridge Connection Status Component
 *
 * Visual indicator showing WebSocket connection status.
 * - Green = connected
 * - Yellow = reconnecting
 * - Red = disconnected
 */

import React from "react";
/** Connection state for transport status indicators */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectionStatusProps {
  /**
   * Current connection state
   */
  connectionState: ConnectionState;

  /**
   * Active transport mode
   */
  activeTransport: "websocket" | "http" | "none";

  /**
   * Number of reconnection attempts
   */
  reconnectAttempts?: number;

  /**
   * Size variant
   */
  size?: "sm" | "md" | "lg";

  /**
   * Show detailed label
   */
  showLabel?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Callback when clicked (for manual reconnection)
   */
  onClick?: () => void;
}

/**
 * Get status color based on connection state
 */
function getStatusColor(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "bg-green-500";
    case "connecting":
    case "reconnecting":
      return "bg-yellow-500";
    case "disconnected":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

/**
 * Get status label based on connection state and transport
 */
function getStatusLabel(
  state: ConnectionState,
  transport: "websocket" | "http" | "none"
): string {
  switch (state) {
    case "connected":
      return transport === "websocket"
        ? "WebSocket Connected"
        : "HTTP Connected";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return "Reconnecting...";
    case "disconnected":
      return "Disconnected";
    default:
      return "Unknown";
  }
}

/**
 * Get dot size based on size variant
 */
function getDotSize(size: "sm" | "md" | "lg"): string {
  switch (size) {
    case "sm":
      return "w-2 h-2";
    case "md":
      return "w-3 h-3";
    case "lg":
      return "w-4 h-4";
    default:
      return "w-3 h-3";
  }
}

/**
 * Get text size based on size variant
 */
function getTextSize(size: "sm" | "md" | "lg"): string {
  switch (size) {
    case "sm":
      return "text-xs";
    case "md":
      return "text-sm";
    case "lg":
      return "text-base";
    default:
      return "text-sm";
  }
}

/**
 * Connection status indicator component
 */
export function ConnectionStatus({
  connectionState,
  activeTransport,
  reconnectAttempts = 0,
  size = "md",
  showLabel = true,
  className = "",
  onClick,
}: ConnectionStatusProps) {
  const isClickable = !!onClick;
  const isAnimating =
    connectionState === "connecting" || connectionState === "reconnecting";

  const containerClasses = [
    "inline-flex items-center gap-2",
    isClickable ? "cursor-pointer hover:opacity-80 transition-opacity" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const dotClasses = [
    getDotSize(size),
    "rounded-full",
    getStatusColor(connectionState),
    isAnimating ? "animate-pulse" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const labelClasses = [getTextSize(size), "text-gray-600 dark:text-gray-400"]
    .filter(Boolean)
    .join(" ");

  const label = getStatusLabel(connectionState, activeTransport);
  const title =
    connectionState === "reconnecting" && reconnectAttempts > 0
      ? `${label} (attempt ${reconnectAttempts})`
      : label;

  return (
    <div
      className={containerClasses}
      onClick={isClickable ? onClick : undefined}
      title={title}
      role="button"
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                onClick?.();
              }
            }
          : undefined
      }
    >
      <span className={dotClasses} aria-hidden="true" />
      {showLabel && <span className={labelClasses}>{label}</span>}
      {!showLabel && <span className="sr-only">{label}</span>}
    </div>
  );
}

/**
 * Compact connection status badge
 */
export function ConnectionStatusBadge({
  connectionState,
  activeTransport,
  reconnectAttempts = 0,
  onClick,
  className = "",
}: Omit<ConnectionStatusProps, "size" | "showLabel">) {
  const isClickable = !!onClick;

  const badgeColor = {
    connected:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    connecting:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    reconnecting:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    disconnected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  }[connectionState];

  const label =
    connectionState === "connected"
      ? activeTransport === "websocket"
        ? "WS"
        : "HTTP"
      : connectionState === "reconnecting"
        ? `Retry ${reconnectAttempts}`
        : connectionState.charAt(0).toUpperCase() + connectionState.slice(1, 4);

  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        badgeColor,
        isClickable ? "cursor-pointer hover:opacity-80 transition-opacity" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={isClickable ? onClick : undefined}
      role="button"
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                onClick?.();
              }
            }
          : undefined
      }
    >
      {label}
    </span>
  );
}

export default ConnectionStatus;
