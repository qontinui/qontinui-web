"use client";

import React, { useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MousePointer2, Mouse, Keyboard, ArrowDown, Move } from "lucide-react";
import type { InputEvent, InputEventType } from "@/types/capture";
import { getButtonName } from "@/types/capture";

export interface EventTimelineProps {
  events: InputEvent[];
  duration: number;
  currentTime: number;
  onSeek: (timestamp: number) => void;
}

const EVENT_COLORS: Record<InputEventType, string> = {
  mouse_move: "bg-text-muted",
  mouse_click: "bg-blue-500",
  mouse_down: "bg-blue-400",
  mouse_up: "bg-blue-300",
  mouse_scroll: "bg-orange-500",
  mouse_drag: "bg-purple-500",
  key_press: "bg-green-500",
  key_down: "bg-green-400",
  key_up: "bg-text-muted",
};

const EVENT_ICONS: Record<
  InputEventType,
  React.ComponentType<{ className?: string }>
> = {
  mouse_move: Move,
  mouse_click: MousePointer2,
  mouse_down: MousePointer2,
  mouse_up: MousePointer2,
  mouse_scroll: ArrowDown,
  mouse_drag: Mouse,
  key_press: Keyboard,
  key_down: Keyboard,
  key_up: Keyboard,
};

const EVENT_LABELS: Record<InputEventType, string> = {
  mouse_move: "Move",
  mouse_click: "Click",
  mouse_down: "Mouse Down",
  mouse_up: "Mouse Up",
  mouse_scroll: "Scroll",
  mouse_drag: "Drag",
  key_press: "Key Press",
  key_down: "Key Down",
  key_up: "Key Up",
};

export const EventTimeline: React.FC<EventTimelineProps> = ({
  events,
  duration,
  currentTime,
  onSeek,
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  const getEventDescription = (event: InputEvent): string => {
    switch (event.eventType) {
      case "mouse_click":
      case "mouse_down":
      case "mouse_up":
        return `${EVENT_LABELS[event.eventType]} ${getButtonName(event.button)} at (${event.x}, ${event.y})`;
      case "mouse_drag":
        return `Drag at (${event.x}, ${event.y})`;
      case "mouse_move":
        return `Move to (${event.x}, ${event.y})`;
      case "key_press":
      case "key_down":
        return `Press ${event.key}${
          event.modifiers?.length ? " + " + event.modifiers.join(" + ") : ""
        }`;
      case "key_up":
        return `Release ${event.key}`;
      case "mouse_scroll":
        return `Scroll at (${event.x}, ${event.y})${event.scrollDy ? ` (${event.scrollDy > 0 ? "down" : "up"})` : ""}`;
      default:
        return "Unknown event";
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;

    onSeek(Math.max(0, Math.min(duration, newTime)));
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    handleTimelineClick(e);
  };

  // Group events by time intervals for better visualization
  const getEventClusters = () => {
    const clusters: { [key: string]: InputEvent[] } = {};
    const clusterSize = Math.max(0.1, duration / 100); // Cluster events within small time windows

    events.forEach((event) => {
      const clusterIndex = Math.floor(event.timestamp / clusterSize);
      const key = `cluster-${clusterIndex}`;
      if (!clusters[key]) {
        clusters[key] = [];
      }
      clusters[key].push(event);
    });

    return clusters;
  };

  const eventClusters = getEventClusters();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Event Timeline</h3>
        <div className="flex gap-2">
          {Object.entries(EVENT_LABELS).map(([type, label]) => {
            const color = EVENT_COLORS[type as keyof typeof EVENT_COLORS];
            return (
              <div key={type} className="flex items-center gap-1 text-xs">
                <div className={`w-2 h-2 rounded-full ${color}`} />
                <span className="text-text-muted">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        className="relative h-20 bg-surface-raised rounded-lg border border-border-subtle cursor-pointer overflow-hidden"
        role="button"
        tabIndex={0}
        onClick={handleTimelineClick}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onSeek(Math.max(0, (currentTime || 0) - duration * 0.05));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onSeek(Math.min(duration, (currentTime || 0) + duration * 0.05));
          }
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseUp}
      >
        {/* Time markers */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: 11 }).map((_, i) => {
            const time = (duration * i) / 10;
            return (
              <div
                key={i}
                className="flex-1 border-l border-border-default relative"
                style={{ flexBasis: "10%" }}
              >
                <span className="absolute -bottom-5 left-0 text-xs text-text-muted transform -translate-x-1/2">
                  {formatTime(time).split(".")[0]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Event markers */}
        <TooltipProvider delayDuration={100}>
          {events.map((event, index) => {
            const position = (event.timestamp / duration) * 100;
            const Icon = EVENT_ICONS[event.eventType];
            const color = EVENT_COLORS[event.eventType];

            return (
              <Tooltip key={`${event.timestamp}-${index}`}>
                <TooltipTrigger asChild>
                  <div
                    className={`absolute top-0 bottom-0 w-1 ${color} opacity-70 hover:opacity-100 hover:w-2 transition-all cursor-pointer z-10`}
                    style={{ left: `${position}%` }}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(event.timestamp);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        ((e) => {
                          e.stopPropagation();
                          onSeek(event.timestamp);
                        })(e);
                      }
                    }}
                  >
                    {/* Event icon at top */}
                    <div className="absolute -top-1 left-1/2 transform -translate-x-1/2">
                      <Icon className={`h-3 w-3 text-white`} />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <div className="space-y-1">
                    <div className="font-semibold text-xs">
                      {EVENT_LABELS[event.eventType]}
                    </div>
                    <div className="text-xs">{formatTime(event.timestamp)}</div>
                    <div className="text-xs text-text-secondary">
                      {getEventDescription(event)}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>

        {/* Current time indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
        >
          <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
            <div className="w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-lg" />
          </div>
          <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 bg-red-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
            {formatTime(currentTime)}
          </div>
        </div>

        {/* Hover preview */}
        <div className="absolute inset-0 pointer-events-none">
          {/* This could show a preview on hover */}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm text-text-muted">
        <div className="flex gap-4">
          <span>
            <span className="font-medium">{events.length}</span> events
          </span>
          <span>
            <span className="font-medium">
              {events.filter((e) => e.eventType === "mouse_click").length}
            </span>{" "}
            clicks
          </span>
          <span>
            <span className="font-medium">
              {
                events.filter((e) =>
                  ["key_press", "key_down"].includes(e.eventType)
                ).length
              }
            </span>{" "}
            keys
          </span>
          <span>
            <span className="font-medium">
              {events.filter((e) => e.eventType === "mouse_scroll").length}
            </span>{" "}
            scrolls
          </span>
        </div>
        <div className="text-xs text-text-muted">
          Click on timeline or markers to seek
        </div>
      </div>

      {/* Event density visualization */}
      <div className="relative h-8 bg-surface-canvas rounded border border-border-subtle overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-around px-1">
          {Object.entries(eventClusters).map(([key, clusterEvents]) => {
            const firstEvent = clusterEvents[0];
            if (!firstEvent) return null;
            const position = (firstEvent.timestamp / duration) * 100;
            const height = Math.min(
              100,
              (clusterEvents.length / events.length) * 100 * 10
            );

            return (
              <div
                key={key}
                className="absolute bottom-0 bg-blue-400 opacity-50 rounded-t"
                style={{
                  left: `${position}%`,
                  height: `${height}%`,
                  width: "2%",
                }}
              />
            );
          })}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-text-muted">Event Density</span>
        </div>
      </div>
    </div>
  );
};
